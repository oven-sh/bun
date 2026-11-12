import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { copyFileSync } from "node:fs";
import { join } from "node:path";
import { canTrim } from "../bundler/compile-trim-features";
import { isHardened } from "./hardened";
import { run } from "./harness/run";
import { describe, test } from "./supported";

const compiler = Bun.which("cc") || Bun.which("gcc") || Bun.which("clang");

const libsecret = /* c */ `
#include <stdlib.h>
#include <string.h>
void g_error_free(void *error) {}
void g_free(void *memory) { free(memory); }
void *g_hash_table_new(void *hash, void *equal) { return NULL; }
void g_hash_table_destroy(void *table) {}
void *g_hash_table_lookup(void *table, void *key) { return NULL; }
int g_hash_table_insert(void *table, void *key, void *value) { return 0; }
void g_list_free(void *list) {}
int secret_password_store_sync(const void *schema, const char *collection, const char *label, const char *password, void *cancellable, void **error, ...) { return 1; }
char *secret_password_lookup_sync(const void *schema, void *cancellable, void **error, ...) { return strdup("from the library"); }
int secret_password_clear_sync(const void *schema, void *cancellable, void **error, ...) { return 1; }
void secret_password_free(char *password) { free(password); }
`;

const nameService = /* c */ `
#include <arpa/inet.h>
#include <errno.h>
#include <netdb.h>
#include <nss.h>
#include <string.h>
#include <unistd.h>
enum nss_status _nss_fromtest_gethostbyname2_r(const char *name, int family, struct hostent *result, char *buffer, size_t size, int *error, int *host_error)
{
    struct { char *none[1]; char *addresses[2]; struct in_addr address; char name[256]; } *memory = (void *)buffer;
    char own[256];
    if (family != AF_INET || gethostname(own, sizeof own) || strcmp(name, own)) {
        *error = ENOENT;
        *host_error = HOST_NOT_FOUND;
        return NSS_STATUS_NOTFOUND;
    }
    if (size < sizeof *memory) {
        *error = ERANGE;
        *host_error = NETDB_INTERNAL;
        return NSS_STATUS_TRYAGAIN;
    }
    memset(memory, 0, sizeof *memory);
    strcpy(memory->name, name);
    inet_pton(AF_INET, "192.0.2.7", &memory->address);
    memory->addresses[0] = (char *)&memory->address;
    *result = (struct hostent){ memory->name, memory->none, AF_INET, sizeof memory->address, memory->addresses };
    return NSS_STATUS_SUCCESS;
}
`;

async function compileLibrary(dir: string, name: string) {
  const library = join(dir, name);
  expect(await run([compiler!, "-shared", "-fPIC", "-O1", "-o", library, join(dir, "library.c")])).toMatchObject({
    exitCode: 0,
  });
  return library;
}

async function build(dir: string) {
  const executable = join(dir, "program");
  const source = join(dir, "program.ts");
  const built = await run([bunExe(), "build", "--compile", "--aot", "--trim", source, "--outfile", executable]);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.any(String), exitCode: 0 });
  return executable;
}

const withNameServices = [
  "unshare",
  "--user",
  "--map-root-user",
  "--mount",
  "sh",
  "-c",
  'mount --bind "$1" /etc/nsswitch.conf && exec "$0"',
];
const canReplaceNameServices =
  isHardened &&
  Bun.spawnSync({ cmd: [...withNameServices, "true", "/dev/null"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

const withoutAddressRandomization = ["setarch", process.arch === "x64" ? "x86_64" : "aarch64", "-R"];
const canFixAddresses =
  isHardened &&
  Bun.spawnSync({ cmd: [...withoutAddressRandomization, "true"], stdout: "ignore", stderr: "ignore" }).exitCode === 0;

describe.skipIf(!isHardened || !canTrim)("a trimmed executable of a Bun built with --hardened=on", () => {
  test.skipIf(!compiler)("Bun.secrets loads libsecret", async () => {
    using dir = tempDir("aot-hardened-libsecret", {
      "library.c": libsecret,
      "program.ts": `console.log(await Bun.secrets.get({ service: "service", name: "name" }));`,
    });
    const library = await compileLibrary(String(dir), "libsecret-1.so.0");
    for (const name of ["libglib-2.0.so.0", "libgobject-2.0.so.0"]) copyFileSync(library, join(String(dir), name));
    expect(await run([await build(String(dir))], undefined, { ...bunEnv, LD_LIBRARY_PATH: String(dir) })).toEqual({
      stdout: "from the library\n",
      stderr: "",
      exitCode: 0,
    });
  });

  test.skipIf(!compiler || !canReplaceNameServices)(
    "dns.lookup(os.hostname()) uses the modules of nsswitch.conf",
    async () => {
      using dir = tempDir("aot-hardened-name-service", {
        "library.c": nameService,
        "nsswitch.conf": "hosts: fromtest\n",
        "program.ts": `import { lookup } from "node:dns/promises";
import { hostname } from "node:os";
console.log(JSON.stringify(await lookup(hostname(), 4)));`,
      });
      await compileLibrary(String(dir), "libnss_fromtest.so.2");
      const cmd = [...withNameServices, await build(String(dir)), join(String(dir), "nsswitch.conf")];
      expect(await run(cmd, undefined, { ...bunEnv, LD_LIBRARY_PATH: String(dir) })).toEqual({
        stdout: '{"address":"192.0.2.7","family":4}\n',
        stderr: "",
        exitCode: 0,
      });
    },
  );

  test.skipIf(!canFixAddresses)("starts a program without address randomization", async () => {
    using dir = tempDir("aot-hardened-fixed-addresses", {
      "program.ts": `const { stdout, stderr, exitCode } = Bun.spawnSync(["sh", "-c", "echo started"]);
console.log(JSON.stringify({ stdout: stdout.toString(), stderr: stderr.toString(), exitCode }));`,
    });
    expect(await run([...withoutAddressRandomization, await build(String(dir))])).toEqual({
      stdout: '{"stdout":"started\\n","stderr":"","exitCode":0}\n',
      stderr: "",
      exitCode: 0,
    });
  });
});
