// Fetches the Windows SDK and the Visual C++ headers and libraries of Microsoft, and writes what clang
// needs to compile and link C for Windows (x64) against them on a machine that is not Windows.
//
//   bun windows-sdk.ts <directory>
//
// The code for Windows of the portable image and its host are built with clang for the MSVC target and
// Microsoft's SDK on a Windows machine, where they also run. This is the same compiler, the same target
// and the same headers and libraries on the machine that builds the image: what is compiled and linked
// here is checked against the declarations and the layouts of Windows before a person runs it there.
// Nothing of it runs here.
//
// The packages are Microsoft's, from nuget.org, with the hashes below:
//   Microsoft.Windows.SDK.CPP, Microsoft.Windows.SDK.CPP.x64   the Windows SDK (licence: aka.ms/WinSDKLicenseURL)
//   VisualCppTools.Community.VS2017Layout                      vcruntime.h and the import libraries of the
//                                                              C runtime (licence: go.microsoft.com/fwlink/?LinkId=831113)
//   Microsoft.Windows.WDK.x64                                  the Windows Driver Kit, for its headers: the
//                                                              structures of the NT API that bun's code for
//                                                              Windows passes to ntdll are declared there
//                                                              (licence: LICENSE.txt of the package)
//
// In <directory>:
//   nupkg/, sdk/, sdk-x64/, vc/, wdk/   the packages, and what is in them
//   headers.yaml                   clang's view of the header directories, in which a name matches in
//                                  any case: the headers of Windows name each other in the case of a
//                                  file system that does not tell them apart
//   lib-x64/                       links to every library, by its name and by its name in lower case
//   windows-x64.cfg                for `clang --config=<directory>/windows-x64.cfg`
//   versions.json                  what was fetched, and `kernel_headers`: the directory of ntifs.h, which
//                                  is in clang's view and not in the configuration (a program for Windows
//                                  does not include it; ../bindings/verify.ts does, to read layouts)
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";

const sdkVersion = "10.0.26100.4654";
const sdkDirectory = "10.0.26100.0";
const toolsVersion = "14.11.25547";
const driverKitVersion = "10.0.26100.4204";
const packages = [
  { id: "microsoft.windows.sdk.cpp", version: sdkVersion, into: "sdk", sha256: "39173d78ec05c7c123928fd45f5f3b84d2933c1a87cec015c90227b30bc950bd" },
  { id: "microsoft.windows.sdk.cpp.x64", version: sdkVersion, into: "sdk-x64", sha256: "81d8682ff04ba4dc3c3757b749f88eb9d109bd17179c233d36b0c71780f2aad5" },
  { id: "visualcpptools.community.vs2017layout", version: toolsVersion, into: "vc", sha256: "248fcd153c85df1c1fab06041230a9ae44f8c6022337861dc61615e73bf4e4d6" },
  { id: "microsoft.windows.wdk.x64", version: driverKitVersion, into: "wdk", sha256: "829fcd80aff6850e72193d56ef5d9c59414c8aa32aa4cb366419b146f4b6cf6a" },
];

const directory = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw new Error("usage: bun windows-sdk.ts <directory>");
mkdirSync(join(directory, "nupkg"), { recursive: true });

function sha256Of(path: string) {
  const hash = createHash("sha256");
  hash.update(readFileSync(path));
  return hash.digest("hex");
}

for (const p of packages) {
  const file = join(directory, "nupkg", `${p.id}.${p.version}.nupkg`);
  if (!existsSync(file) || sha256Of(file) !== p.sha256) {
    const url = `https://api.nuget.org/v3-flatcontainer/${p.id}/${p.version}/${p.id}.${p.version}.nupkg`;
    console.log(`fetching ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    await Bun.write(file, response);
    const found = sha256Of(file);
    if (found !== p.sha256) throw new Error(`${file}: sha256 ${found}, expected ${p.sha256}`);
  }
  const into = join(directory, p.into);
  if (!existsSync(join(into, ".unpacked"))) {
    rmSync(into, { recursive: true, force: true });
    mkdirSync(into, { recursive: true });
    const unpacked = Bun.spawnSync(["unzip", "-q", "-o", file, "-d", into], { stdout: "inherit", stderr: "inherit" });
    if (unpacked.exitCode !== 0) throw new Error(`unzip ${file}: exit code ${unpacked.exitCode}`);
    writeFileSync(join(into, ".unpacked"), `${p.id} ${p.version}\n`);
  }
}

const sdkInclude = join(directory, "sdk/c/Include", sdkDirectory);
const toolsInclude = join(directory, "vc/lib/native/include");
const includes = [toolsInclude, ...["ucrt", "shared", "um", "winrt"].map(name => join(sdkInclude, name))];
const kernelInclude = join(directory, "wdk/c/Include", sdkDirectory, "km");
for (const path of [...includes, kernelInclude]) if (!existsSync(path)) throw new Error(`${path} is not in the package`);

type Entry = { name: string; type: "file"; "external-contents": string } | { name: string; type: "directory"; contents: Entry[] };
function entriesOf(path: string): Entry[] {
  return readdirSync(path, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .map(entry =>
      entry.isDirectory()
        ? { name: entry.name, type: "directory" as const, contents: entriesOf(join(path, entry.name)) }
        : { name: entry.name, type: "file" as const, "external-contents": join(path, entry.name) },
    );
}
writeFileSync(
  join(directory, "headers.yaml"),
  JSON.stringify({
    version: 0,
    "case-sensitive": "false",
    roots: [...includes, kernelInclude].map(path => ({ name: path, type: "directory", contents: entriesOf(path) })),
  }) + "\n",
);

const libraries = join(directory, "lib-x64");
rmSync(libraries, { recursive: true, force: true });
mkdirSync(libraries, { recursive: true });
let linked = 0;
// The first directory that has a name gives it.
for (const from of [join(directory, "vc/lib/native/lib/x64"), join(directory, "sdk-x64/c/ucrt/x64"), join(directory, "sdk-x64/c/um/x64")]) {
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (!entry.isFile() || !/\.(lib|obj)$/i.test(entry.name)) continue;
    for (const name of new Set([entry.name, entry.name.toLowerCase()])) {
      const link = join(libraries, name);
      if (lstatSync(link, { throwIfNoEntry: false })) continue;
      symlinkSync(join(from, entry.name), link);
      linked++;
    }
  }
}

const configuration = join(directory, "windows-x64.cfg");
writeFileSync(
  configuration,
  [
    "--target=x86_64-pc-windows-msvc",
    // The version of the compiler that the headers of the C runtime were written for.
    "-fms-compatibility-version=19.11",
    "-ivfsoverlay",
    join(directory, "headers.yaml"),
    // After the headers of the compiler itself, which has its own for what the processor has
    // (emmintrin.h): the order of a machine that has Visual Studio.
    ...includes.flatMap(path => ["-idirafter", path]),
    "-fuse-ld=lld",
    `-L${libraries}`,
    "",
  ].join("\n"),
);
writeFileSync(
  join(directory, "versions.json"),
  JSON.stringify(
    {
      windows_sdk: sdkVersion,
      visual_cpp_tools: toolsVersion,
      windows_driver_kit: driverKitVersion,
      kernel_headers: kernelInclude,
      packages: packages.map(p => ({ id: p.id, version: p.version, sha256: p.sha256 })),
      clang_configuration: configuration,
    },
    null,
    1,
  ) + "\n",
);
console.log(`${configuration}: Windows SDK ${sdkVersion}, Visual C++ tools ${toolsVersion}, ${includes.length} header directories, ${linked} names of libraries`);
