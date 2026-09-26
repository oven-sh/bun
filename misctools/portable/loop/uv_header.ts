// Writes what the C of the portable image includes where bun's C for Windows includes the headers of
// Windows and of libuv: uSockets on libuv, compiled into an image whose compiler target is Linux.
//
//   bun uv_header.ts --facts <layout.image.json> --out <directory>
//
// <layout.image.json> is what `bun_fs_slice.img --layout` prints: the sizes, alignments and offsets
// that the Rust bindings of bun (bun_libuv_sys, bun_windows_sys) have in the image. They are the
// layout that ../bindings/verify.ts and compare.ts check against the headers on a Windows machine.
//
// In <directory>:
//   bun_windows_c.h      the declarations. Types have a fixed width (a C `long` of the image has 64
//                        bits, a `long` of Windows 32). A structure of libuv is its size, its
//                        alignment and the fields that uSockets reads, each at its offset, all from
//                        the facts, and _Static_assert says so again for the C as it is compiled. A
//                        function of Windows or of libuv is an inline function that calls through
//                        the import table of the image, with the calling convention of Windows x64.
//                        A callback type has that calling convention.
//   winsock2.h, uv.h, .. the names that the sources include. Each one includes bun_windows_c.h.
//   errno.h              stands before the errno.h of the image's C library, whose numbers are the
//                        ones of Linux: errno and the error numbers of the C runtime of Windows are
//                        in bun_windows_c.h, as the headers of Windows bring them along
//   imports.s            the entries of the import table (section bun_imports, as
//                        bun_windows_sys::host_imports::Import), one section for each, so that the
//                        linker keeps the ones that are called
//   check_on_windows.c   for a Windows machine: includes the headers of the Windows SDK and of libuv
//                        and fails to compile where a constant, a size or an offset of
//                        bun_windows_c.h is not the one of those headers
//   check_on_windows.cpp the same for the functions and the callbacks: C++, because a template can
//                        take the type of a function apart. What bun_windows_c.h calls a function
//                        with is compared with the declaration of the headers, argument by argument:
//                        how many there are, how wide each is, whether it is a pointer, and how wide
//                        what it points at is
//
// Where the declarations come from:
//   libuv functions and callback types   src/libuv_sys/libuv.rs, the `extern` block of the bindings
//   structures of libuv                  the facts
//   Winsock and kernel32                 the tables of this file. bun's Rust does not call most of
//                                        them (uSockets does), so no binding declares them. What the
//                                        bindings do declare (src/windows_sys/externs.rs, `ws2_32`)
//                                        is compared with the tables here, and check_on_windows.c
//                                        compares all of it with the SDK.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const here = dirname(import.meta.path);
const repo = resolve(here, "../../..");
const argument = (name: string) => {
  const at = process.argv.indexOf(name);
  if (at < 0 || at + 1 >= process.argv.length) throw new Error(`usage: bun uv_header.ts --facts <layout.image.json> --out <directory>`);
  return process.argv[at + 1];
};
const out = resolve(argument("--out"));
type Fact = { size: number; align: number; fields: Record<string, { offset: number; size: number }> };
const facts: Record<string, Fact> = JSON.parse(readFileSync(argument("--facts"), "utf8")).types;

// ---- libuv: what uSockets uses of it ----

/** The structures that uSockets allocates or reads, and the C type of each field that it reads. */
const uvStructs: Record<string, Record<string, string>> = {
  uv_loop_t: { data: "void *", active_handles: "uint32_t" },
  uv_handle_t: { data: "void *", loop: "struct uv_loop_s *", type: "int32_t" },
  uv_poll_t: { data: "void *", loop: "struct uv_loop_s *", type: "int32_t" },
  uv_timer_t: { data: "void *", loop: "struct uv_loop_s *", type: "int32_t" },
  uv_async_t: { data: "void *", loop: "struct uv_loop_s *", type: "int32_t" },
  uv_prepare_t: { data: "void *", loop: "struct uv_loop_s *", type: "int32_t" },
  uv_check_t: { data: "void *", loop: "struct uv_loop_s *", type: "int32_t" },
};
const uvFunctions = [
  "uv_loop_new", "uv_loop_delete", "uv_run", "uv_now", "uv_update_time", "uv_ref", "uv_unref", "uv_close", "uv_is_closing",
  "uv_poll_init_socket", "uv_poll_start", "uv_poll_stop", "uv_timer_init", "uv_timer_start", "uv_timer_stop",
  "uv_prepare_init", "uv_prepare_start", "uv_prepare_stop", "uv_check_init", "uv_check_start", "uv_check_stop",
  "uv_async_init", "uv_async_send", "uv__winsock_ensure",
];
const uvCallbacks = ["uv_close_cb", "uv_poll_cb", "uv_timer_cb", "uv_async_cb", "uv_prepare_cb", "uv_check_cb"];
/** uv.h: enum uv_poll_event, uv_run_mode, uv_handle_type, and UV_EOF of uv/errno.h. */
const uvConstants: Record<string, number> = {
  UV_READABLE: 1, UV_WRITABLE: 2, UV_DISCONNECT: 4, UV_PRIORITIZED: 8,
  UV_RUN_DEFAULT: 0, UV_RUN_ONCE: 1, UV_RUN_NOWAIT: 2,
  UV_POLL: 8, UV_EOF: -4095,
};

/** The types of the bindings, in C. */
const rustTypes: Record<string, string> = {
  c_int: "int32_t", c_uint: "uint32_t", c_void: "void", c_char: "char", u64: "uint64_t", i64: "int64_t", usize: "uint64_t",
  u32: "uint32_t", i32: "int32_t", ReturnCode: "int32_t", RunMode: "int32_t", uv_os_sock_t: "SOCKET", SOCKET: "SOCKET",
  Loop: "uv_loop_t", Timer: "uv_timer_t",
  ...Object.fromEntries(Object.keys(uvStructs).map(name => [name, name])),
  ...Object.fromEntries(uvCallbacks.map(name => [name, name])),
};
function cType(rust: string): string {
  const type = rust.trim();
  const pointer = /^\*(mut|const)\s+(.*)$/.exec(type);
  if (pointer) return `${pointer[1] === "const" ? "const " : ""}${cType(pointer[2])} *`;
  const known = rustTypes[type];
  if (!known) throw new Error(`uv_header.ts does not know the type ${type} of the bindings`);
  return known;
}
type Function = { library: string; name: string; returns: string; parameters: [type: string, name: string][] };
const libuvSource = readFileSync(join(repo, "src/libuv_sys/libuv.rs"), "utf8");
function fromBindings(name: string): Function {
  const found = new RegExp(`\\bpub fn ${name}\\(([^)]*)\\)\\s*(?:->\\s*([^;]+))?;`).exec(libuvSource);
  if (!found) throw new Error(`src/libuv_sys/libuv.rs does not declare ${name}`);
  const parameters = found[1]
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const colon = part.indexOf(":");
      return [cType(part.slice(colon + 1)), part.slice(0, colon).trim().replace(/_$/, "")] as [string, string];
    });
  return { library: "libuv", name, returns: found[2] ? cType(found[2]) : "void", parameters };
}
function callbackFromBindings(name: string): string {
  const found = new RegExp(`\\bpub(?:\\(crate\\))? type ${name} =\\s*Option<unsafe extern "C" fn\\(([^)]*)\\)>;`).exec(libuvSource);
  if (!found) throw new Error(`src/libuv_sys/libuv.rs does not declare ${name}`);
  const parameters = found[1].split(",").map(part => cType(part)).join(", ");
  return `typedef void (BUN_WINDOWS_ABI *${name})(${parameters});`;
}

// ---- Winsock, kernel32, the C runtime: the tables ----

/** name, value as C, and the header of the SDK that check_on_windows.c gets it from. */
const constants: [string, string][] = [
  ["AF_UNSPEC", "0"], ["AF_UNIX", "1"], ["AF_INET", "2"], ["AF_INET6", "23"],
  ["SOCK_STREAM", "1"], ["SOCK_DGRAM", "2"],
  ["IPPROTO_IP", "0"], ["IPPROTO_TCP", "6"], ["IPPROTO_UDP", "17"], ["IPPROTO_IPV6", "41"],
  ["INADDR_ANY", "0x00000000u"], ["INADDR_LOOPBACK", "0x7f000001u"],
  ["SOL_SOCKET", "0xffff"], ["SO_ACCEPTCONN", "0x0002"], ["SO_REUSEADDR", "0x0004"], ["SO_KEEPALIVE", "0x0008"],
  ["SO_BROADCAST", "0x0020"], ["SO_LINGER", "0x0080"], ["SO_SNDBUF", "0x1001"], ["SO_RCVBUF", "0x1002"],
  ["SO_ERROR", "0x1007"], ["SO_TYPE", "0x1008"], ["SO_EXCLUSIVEADDRUSE", "(~0x0004)"],
  ["TCP_NODELAY", "0x0001"], ["TCP_KEEPALIVE", "3"],
  ["IP_TOS", "3"], ["IP_TTL", "4"], ["IP_MULTICAST_IF", "9"], ["IP_MULTICAST_TTL", "10"], ["IP_MULTICAST_LOOP", "11"],
  ["IP_ADD_MEMBERSHIP", "12"], ["IP_DROP_MEMBERSHIP", "13"], ["IP_ADD_SOURCE_MEMBERSHIP", "15"], ["IP_DROP_SOURCE_MEMBERSHIP", "16"],
  ["IP_PKTINFO", "19"], ["IP_RECVTOS", "40"],
  ["IPV6_UNICAST_HOPS", "4"], ["IPV6_MULTICAST_IF", "9"], ["IPV6_MULTICAST_HOPS", "10"], ["IPV6_MULTICAST_LOOP", "11"],
  ["IPV6_ADD_MEMBERSHIP", "12"], ["IPV6_JOIN_GROUP", "12"], ["IPV6_DROP_MEMBERSHIP", "13"], ["IPV6_LEAVE_GROUP", "13"],
  ["IPV6_PKTINFO", "19"], ["IPV6_V6ONLY", "27"], ["IPV6_TCLASS", "39"], ["IPV6_RECVTCLASS", "40"],
  ["MCAST_JOIN_SOURCE_GROUP", "45"], ["MCAST_LEAVE_SOURCE_GROUP", "46"],
  ["MSG_OOB", "0x1"], ["MSG_PEEK", "0x2"], ["MSG_DONTROUTE", "0x4"], ["MSG_PUSH_IMMEDIATE", "0x20"],
  ["SD_RECEIVE", "0"], ["SD_SEND", "1"], ["SD_BOTH", "2"],
  ["FIONBIO", "0x8004667e"], ["SOCKET_ERROR", "(-1)"],
  ["SIO_UDP_CONNRESET", "0x9800000cu"], ["SIO_UDP_NETRESET", "0x9800000fu"], ["SIO_TCP_INITIAL_RTO", "0x98000011u"],
  ["WSA_FLAG_OVERLAPPED", "0x01"], ["WSA_FLAG_NO_HANDLE_INHERIT", "0x80"], ["FROM_PROTOCOL_INFO", "(-1)"],
  ["AI_PASSIVE", "0x00000001"], ["AI_CANONNAME", "0x00000002"], ["AI_NUMERICHOST", "0x00000004"],
["TRUE", "1"], ["FALSE", "0"],
    ["HANDLE_FLAG_INHERIT", "0x00000001"], ["ERROR_PATH_NOT_FOUND", "3"], ["ERROR_FILENAME_EXCED_RANGE", "206"],
  ["UNIX_PATH_MAX", "108"],
  ...(
    [
      ["INTR", 10004], ["BADF", 10009], ["ACCES", 10013], ["FAULT", 10014], ["INVAL", 10022], ["MFILE", 10024], ["WOULDBLOCK", 10035],
      ["INPROGRESS", 10036], ["ALREADY", 10037], ["NOTSOCK", 10038], ["DESTADDRREQ", 10039], ["MSGSIZE", 10040], ["PROTOTYPE", 10041],
      ["NOPROTOOPT", 10042], ["PROTONOSUPPORT", 10043], ["SOCKTNOSUPPORT", 10044], ["OPNOTSUPP", 10045], ["PFNOSUPPORT", 10046],
      ["AFNOSUPPORT", 10047], ["ADDRINUSE", 10048], ["ADDRNOTAVAIL", 10049], ["NETDOWN", 10050], ["NETUNREACH", 10051],
      ["NETRESET", 10052], ["CONNABORTED", 10053], ["CONNRESET", 10054], ["NOBUFS", 10055], ["ISCONN", 10056], ["NOTCONN", 10057],
      ["SHUTDOWN", 10058], ["TIMEDOUT", 10060], ["CONNREFUSED", 10061], ["HOSTDOWN", 10064], ["HOSTUNREACH", 10065],
    ] as [string, number][]
  ).map(([name, value]) => [`WSAE${name}`, String(value)] as [string, string]),
];
/** errno.h of the C runtime of Windows (ucrt). */
const errnos: [string, number][] = [
  ["EPERM", 1], ["ENOENT", 2], ["ESRCH", 3], ["EINTR", 4], ["EIO", 5], ["ENXIO", 6], ["E2BIG", 7], ["ENOEXEC", 8], ["EBADF", 9],
  ["ECHILD", 10], ["EAGAIN", 11], ["ENOMEM", 12], ["EACCES", 13], ["EFAULT", 14], ["EBUSY", 16], ["EEXIST", 17], ["EXDEV", 18],
  ["ENODEV", 19], ["ENOTDIR", 20], ["EISDIR", 21], ["EINVAL", 22], ["ENFILE", 23], ["EMFILE", 24], ["ENOTTY", 25], ["EFBIG", 27],
  ["ENOSPC", 28], ["ESPIPE", 29], ["EROFS", 30], ["EMLINK", 31], ["EPIPE", 32], ["EDOM", 33], ["ERANGE", 34], ["EDEADLK", 36],
  ["ENAMETOOLONG", 38], ["ENOLCK", 39], ["ENOSYS", 40], ["ENOTEMPTY", 41], ["EILSEQ", 42],
  ["EADDRINUSE", 100], ["EADDRNOTAVAIL", 101], ["EAFNOSUPPORT", 102], ["EALREADY", 103], ["EBADMSG", 104], ["ECANCELED", 105],
  ["ECONNABORTED", 106], ["ECONNREFUSED", 107], ["ECONNRESET", 108], ["EDESTADDRREQ", 109], ["EHOSTUNREACH", 110], ["EIDRM", 111],
  ["EINPROGRESS", 112], ["EISCONN", 113], ["ELOOP", 114], ["EMSGSIZE", 115], ["ENETDOWN", 116], ["ENETRESET", 117],
  ["ENETUNREACH", 118], ["ENOBUFS", 119], ["ENODATA", 120], ["ENOLINK", 121], ["ENOMSG", 122], ["ENOPROTOOPT", 123], ["ENOSR", 124],
  ["ENOSTR", 125], ["ENOTCONN", 126], ["ENOTRECOVERABLE", 127], ["ENOTSOCK", 128], ["ENOTSUP", 129], ["EOPNOTSUPP", 130],
  ["EOVERFLOW", 132], ["EOWNERDEAD", 133], ["EPROTO", 134], ["EPROTONOSUPPORT", 135], ["EPROTOTYPE", 136], ["ETIME", 137],
  ["ETIMEDOUT", 138], ["ETXTBSY", 139], ["EWOULDBLOCK", 140],
];

/** The structures: the name in C, the fields as C declares them here, and the names of the fields that check_on_windows.c asks the offset of. */
const structs: { name: string; body: string; fields: string[] }[] = [
  {
    name: "struct in_addr",
    body: "union { struct { uint8_t s_b1, s_b2, s_b3, s_b4; } S_un_b; struct { uint16_t s_w1, s_w2; } S_un_w; uint32_t S_addr; } S_un;",
    fields: ["S_un"],
  },
  { name: "struct in6_addr", body: "union { uint8_t Byte[16]; uint16_t Word[8]; } u;", fields: ["u"] },
  { name: "struct sockaddr", body: "uint16_t sa_family; char sa_data[14];", fields: ["sa_family", "sa_data"] },
  {
    name: "struct sockaddr_in",
    body: "uint16_t sin_family; uint16_t sin_port; struct in_addr sin_addr; char sin_zero[8];",
    fields: ["sin_family", "sin_port", "sin_addr", "sin_zero"],
  },
  {
    name: "struct sockaddr_in6",
    body: "uint16_t sin6_family; uint16_t sin6_port; uint32_t sin6_flowinfo; struct in6_addr sin6_addr; uint32_t sin6_scope_id;",
    fields: ["sin6_family", "sin6_port", "sin6_flowinfo", "sin6_addr", "sin6_scope_id"],
  },
  {
    name: "struct sockaddr_storage",
    body: "uint16_t ss_family; char __ss_pad1[6]; int64_t __ss_align; char __ss_pad2[112];",
    fields: ["ss_family"],
  },
  { name: "struct sockaddr_un", body: "uint16_t sun_family; char sun_path[108];", fields: ["sun_family", "sun_path"] },
  {
    name: "struct addrinfo",
    body: "int32_t ai_flags; int32_t ai_family; int32_t ai_socktype; int32_t ai_protocol; uint64_t ai_addrlen; char *ai_canonname; struct sockaddr *ai_addr; struct addrinfo *ai_next;",
    fields: ["ai_flags", "ai_family", "ai_socktype", "ai_protocol", "ai_addrlen", "ai_canonname", "ai_addr", "ai_next"],
  },
  { name: "struct linger", body: "uint16_t l_onoff; uint16_t l_linger;", fields: ["l_onoff", "l_linger"] },
  { name: "struct ip_mreq", body: "struct in_addr imr_multiaddr; struct in_addr imr_interface;", fields: ["imr_multiaddr", "imr_interface"] },
  {
    name: "struct ip_mreq_source",
    body: "struct in_addr imr_multiaddr; struct in_addr imr_sourceaddr; struct in_addr imr_interface;",
    fields: ["imr_multiaddr", "imr_sourceaddr", "imr_interface"],
  },
  { name: "struct ipv6_mreq", body: "struct in6_addr ipv6mr_multiaddr; uint32_t ipv6mr_interface;", fields: ["ipv6mr_multiaddr", "ipv6mr_interface"] },
  {
    name: "struct group_source_req",
    body: "uint32_t gsr_interface; struct sockaddr_storage gsr_group; struct sockaddr_storage gsr_source;",
    fields: ["gsr_interface", "gsr_group", "gsr_source"],
  },
  { name: "WSABUF", body: "uint32_t len; char *buf;", fields: ["len", "buf"] },
  { name: "TCP_INITIAL_RTO_PARAMETERS", body: "uint16_t Rtt; uint8_t MaxSynRetransmissions;", fields: ["Rtt", "MaxSynRetransmissions"] },
  // uSockets copies it and hands it back to Windows: its size is all it needs of it.
  { name: "WSAPROTOCOL_INFOW", body: "uint8_t bun_bytes[628];", fields: [] },
  { name: "INIT_ONCE", body: "void *Ptr;", fields: ["Ptr"] },
];
/** The names that the facts have the same structure under. */
const factNames: Record<string, string> = {
  "struct sockaddr": "sockaddr", "struct sockaddr_in": "sockaddr_in", "struct sockaddr_in6": "sockaddr_in6",
  "struct sockaddr_storage": "sockaddr_storage", "struct addrinfo": "addrinfo",
};

const windowsFunctions: Function[] = (
  [
    ["ws2_32", "WSAGetLastError", "int32_t", ""],
    ["ws2_32", "WSASetLastError", "void", "int32_t error"],
    ["ws2_32", "WSASocketW", "SOCKET", "int32_t af, int32_t type, int32_t protocol, WSAPROTOCOL_INFOW *info, uint32_t group, uint32_t flags"],
    ["ws2_32", "WSADuplicateSocketW", "int32_t", "SOCKET s, uint32_t process, WSAPROTOCOL_INFOW *info"],
    ["ws2_32", "WSAIoctl", "int32_t", "SOCKET s, uint32_t code, void *in, uint32_t in_size, void *out, uint32_t out_size, uint32_t *returned, void *overlapped, void *completion"],
    ["ws2_32", "socket", "SOCKET", "int32_t af, int32_t type, int32_t protocol"],
    ["ws2_32", "closesocket", "int32_t", "SOCKET s"],
    ["ws2_32", "ioctlsocket", "int32_t", "SOCKET s, int32_t command, uint32_t *argument"],
    ["ws2_32", "bind", "int32_t", "SOCKET s, const struct sockaddr *name, int32_t length"],
    ["ws2_32", "listen", "int32_t", "SOCKET s, int32_t backlog"],
    ["ws2_32", "accept", "SOCKET", "SOCKET s, struct sockaddr *address, int32_t *length"],
    ["ws2_32", "connect", "int32_t", "SOCKET s, const struct sockaddr *name, int32_t length"],
    ["ws2_32", "shutdown", "int32_t", "SOCKET s, int32_t how"],
    ["ws2_32", "recv", "int32_t", "SOCKET s, char *buffer, int32_t length, int32_t flags"],
    ["ws2_32", "send", "int32_t", "SOCKET s, const char *buffer, int32_t length, int32_t flags"],
    ["ws2_32", "recvfrom", "int32_t", "SOCKET s, char *buffer, int32_t length, int32_t flags, struct sockaddr *from, int32_t *from_length"],
    ["ws2_32", "sendto", "int32_t", "SOCKET s, const char *buffer, int32_t length, int32_t flags, const struct sockaddr *to, int32_t to_length"],
    ["ws2_32", "setsockopt", "int32_t", "SOCKET s, int32_t level, int32_t name, const char *value, int32_t length"],
    ["ws2_32", "getsockopt", "int32_t", "SOCKET s, int32_t level, int32_t name, char *value, int32_t *length"],
    ["ws2_32", "getsockname", "int32_t", "SOCKET s, struct sockaddr *name, int32_t *length"],
    ["ws2_32", "getpeername", "int32_t", "SOCKET s, struct sockaddr *name, int32_t *length"],
    ["ws2_32", "getaddrinfo", "int32_t", "const char *node, const char *service, const struct addrinfo *hints, struct addrinfo **result"],
    ["ws2_32", "freeaddrinfo", "void", "struct addrinfo *info"],
    ["kernel32", "SetHandleInformation", "int32_t", "HANDLE object, uint32_t mask, uint32_t flags"],
    ["kernel32", "SetLastError", "void", "uint32_t error"],
    ["kernel32", "InitOnceExecuteOnce", "int32_t", "INIT_ONCE *once, PINIT_ONCE_FN function, void *parameter, void **context"],
    ["kernel32", "GetLastError", "uint32_t", ""],
    ["ucrtbase", "_errno", "int32_t *", ""],
  ] as [string, string, string, string][]
).map(([library, name, returns, parameters]) => ({
  library,
  name,
  returns,
  parameters: parameters
    .split(",")
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const at = part.search(/[A-Za-z_0-9]+$/);
      return [part.slice(0, at).trim(), part.slice(at)] as [string, string];
    }),
}));

// ---- what the bindings declare is what the tables say ----

{
  const source = readFileSync(join(repo, "src/windows_sys/externs.rs"), "utf8");
  const table = new Map(constants);
  const different: string[] = [];
  for (const found of source.matchAll(/pub const ([A-Z_0-9a-z]+): (?:c_int|Win32Error|u32|i32|c_uint|u16) = (?:Win32Error\()?(-?(?:0x[0-9a-fA-F_]+|[0-9_]+))\)?;/g)) {
    const mine = table.get(found[1]);
    if (mine === undefined) continue;
    if (Number(mine.replace(/[()u]/g, "")) !== Number(found[2].replaceAll("_", ""))) different.push(`${found[1]}: ${mine} here, ${found[2]} in src/windows_sys/externs.rs`);
  }
  if (different.length) throw new Error(`the tables of uv_header.ts and the bindings do not agree:\n${different.join("\n")}`);
}

// ---- the header ----

const functions = [...uvFunctions.map(fromBindings), ...windowsFunctions];
const entry = (fn: Function) => `bun_import__${fn.library}__${fn.name}`;
const lines: string[] = [];
lines.push(
  "// Written by misctools/portable/loop/uv_header.ts. Do not edit.",
  "//",
  "// The declarations of Windows and of libuv for the C of the portable image. See uv_header.ts for",
  "// where each of them comes from and for what checks them.",
  "#ifndef BUN_WINDOWS_C_H",
  "#define BUN_WINDOWS_C_H",
  "#include <stddef.h>",
  "#include <stdint.h>",
  "// The headers of Windows bring the string functions of the C runtime along. Here they are the ones of",
  "// the C library of the image.",
  "#include <string.h>",
  "",
  "#define BUN_WINDOWS_ABI __attribute__((ms_abi))",
  "",
  "typedef uint64_t SOCKET;",
  "typedef void *HANDLE;",
  "typedef uint8_t BYTE, UCHAR;",
  "typedef uint16_t WORD, USHORT, ADDRESS_FAMILY, WCHAR;",
  "typedef int32_t BOOL, INT, LONG;",
  "typedef uint32_t DWORD, UINT, ULONG;",
  "typedef uint64_t UINT_PTR, ULONG_PTR, DWORD_PTR, SIZE_T;",
  "typedef int64_t INT_PTR, LONG_PTR, SSIZE_T;",
  "typedef int32_t socklen_t;",
  "#ifndef BUN_WINDOWS_C_SSIZE_T",
  "#define BUN_WINDOWS_C_SSIZE_T",
  "typedef int64_t ssize_t;",
  "#endif",
  "#define INVALID_SOCKET ((SOCKET)(~(SOCKET)0))",
  "#define INVALID_HANDLE_VALUE ((HANDLE)(int64_t)-1)",
  "",
);
for (const [name, value] of constants) lines.push(`#define ${name} ${value}`);
lines.push("#define TCP_INITIAL_RTO_UNSPECIFIED_RTT ((uint16_t)-1)", "#define TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS ((uint8_t)-2)", "");
for (const { name, body } of structs) {
  if (name.startsWith("struct ")) lines.push(`${name} { ${body} };`);
  else lines.push(`typedef struct _${name} { ${body} } ${name};`);
}
lines.push(
  "typedef INIT_ONCE *PINIT_ONCE;",
  "typedef void *PVOID, *LPVOID;",
  "#define INIT_ONCE_STATIC_INIT {0}",
  "// The calling convention that the sources name: on x64 Windows has one.",
  "#define CALLBACK BUN_WINDOWS_ABI",
  "#define WINAPI BUN_WINDOWS_ABI",
  "typedef BOOL (CALLBACK *PINIT_ONCE_FN)(PINIT_ONCE once, PVOID parameter, PVOID *context);",
  "#define s_addr S_un.S_addr",
  "#define s6_addr u.Byte",
  "typedef struct sockaddr SOCKADDR;",
  "typedef struct sockaddr_in SOCKADDR_IN;",
  "typedef struct sockaddr_in6 SOCKADDR_IN6;",
  "typedef struct sockaddr_storage SOCKADDR_STORAGE;",
  "typedef struct addrinfo ADDRINFOA;",
  "static const struct in6_addr in6addr_any = {{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0}}};",
  "static const struct in6_addr in6addr_loopback = {{{0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1}}};",
  "static inline uint16_t htons(uint16_t value) { return __builtin_bswap16(value); }",
  "static inline uint16_t ntohs(uint16_t value) { return __builtin_bswap16(value); }",
  "static inline uint32_t htonl(uint32_t value) { return __builtin_bswap32(value); }",
  "static inline uint32_t ntohl(uint32_t value) { return __builtin_bswap32(value); }",
  "",
);
for (const [name, own] of Object.entries(factNames)) {
  const fact = facts[own];
  if (!fact) throw new Error(`the facts do not have ${own}`);
  lines.push(`_Static_assert(sizeof(${name}) == ${fact.size} && _Alignof(${name}) == ${fact.align}, "${name}: the bindings of bun have another size or alignment");`);
  for (const [field, { offset }] of Object.entries(fact.fields))
    lines.push(`_Static_assert(offsetof(${name}, ${field}) == ${offset}, "${name}.${field}: the bindings of bun have it at another offset");`);
}
lines.push("", "// libuv");
for (const [name, value] of Object.entries(uvConstants)) lines.push(`#define ${name} (${value})`);
for (const name of Object.keys(uvStructs)) lines.push(`typedef struct ${name.replace(/_t$/, "_s")} ${name};`);
for (const [name, typed] of Object.entries(uvStructs)) {
  const fact = facts[name];
  if (!fact) throw new Error(`the facts do not have ${name}`);
  const fields = Object.entries(typed)
    .map(([field, type]) => {
      const known = fact.fields[field];
      if (!known) throw new Error(`the facts do not have ${name}.${field}`);
      return { field, type, ...known };
    })
    .sort((a, b) => a.offset - b.offset);
  lines.push(`struct ${name.replace(/_t$/, "_s")} {`);
  let at = 0;
  for (const { field, type, offset, size } of fields) {
    if (offset > at) lines.push(`  uint8_t bun_bytes_at_${at}[${offset - at}];`);
    lines.push(`  ${type}${type.endsWith("*") ? "" : " "}${field};`);
    at = offset + size;
  }
  if (fact.size > at) lines.push(`  uint8_t bun_bytes_at_${at}[${fact.size - at}];`);
  lines.push(`} __attribute__((packed, aligned(${fact.align})));`);
  lines.push(`_Static_assert(sizeof(${name}) == ${fact.size} && _Alignof(${name}) == ${fact.align}, "${name}: not the size and the alignment of the bindings of bun");`);
  for (const { field, offset, size } of fields)
    lines.push(`_Static_assert(offsetof(${name}, ${field}) == ${offset} && sizeof(((${name} *)0)->${field}) == ${size}, "${name}.${field}: not where the bindings of bun have it");`);
}
for (const name of uvCallbacks) lines.push(callbackFromBindings(name));
lines.push(
  "",
  "// An entry of the import table of the image (bun_windows_sys::host_imports::Import), and the",
  "// address it holds once the host has resolved it.",
  "struct bun_import { void *address; const char *library; const char *symbol; };",
  "void *__bun_import_address(struct bun_import *import);",
  "static inline void *bun_import_address(struct bun_import *import) {",
  "  void *address = __atomic_load_n(&import->address, __ATOMIC_RELAXED);",
  "  return address ? address : __bun_import_address(import);",
  "}",
  "",
);
for (const fn of functions) {
  const types = fn.parameters.map(([type]) => type).join(", ") || "void";
  const declared = fn.parameters.map(([type, name]) => `${type}${type.endsWith("*") ? "" : " "}${name}`).join(", ") || "void";
  const names = fn.parameters.map(([, name]) => name).join(", ");
  lines.push(
    `extern struct bun_import ${entry(fn)};`,
    `static inline ${fn.returns}${fn.returns.endsWith("*") ? "" : " "}${fn.name}(${declared}) {`,
    `  ${fn.returns === "void" ? "" : "return "}((${fn.returns} (BUN_WINDOWS_ABI *)(${types}))bun_import_address(&${entry(fn)}))(${names});`,
    "}",
  );
}
lines.push("", "// errno of the C runtime of Windows, and its numbers", "#define errno (*_errno())");
for (const [name, value] of errnos) lines.push(`#define ${name} ${value}`);
lines.push("", "#endif");

mkdirSync(out, { recursive: true });
writeFileSync(join(out, "bun_windows_c.h"), lines.join("\n") + "\n");
for (const name of ["winsock2.h", "ws2tcpip.h", "ws2ipdef.h", "mstcpip.h", "afunix.h", "io.h", "BaseTsd.h", "windows.h", "uv.h", "errno.h"])
  writeFileSync(join(out, name), `// Written by misctools/portable/loop/uv_header.ts. Do not edit.\n#include "bun_windows_c.h"\n`);
writeFileSync(
  join(out, "imports.s"),
  [
    "# Written by misctools/portable/loop/uv_header.ts. Do not edit.",
    "#",
    "# The imports of the C of the image: entries of the table that bun_windows_sys::host_imports reads.",
    ...functions.flatMap((fn, index) => [
      `\t.section .rodata.bun_import_names,"a",@progbits`,
      `.Llibrary${index}:\n\t.asciz "${fn.library}"`,
      `.Lsymbol${index}:\n\t.asciz "${fn.name}"`,
      `\t.section bun_imports,"aw",@progbits,unique,${index + 1}`,
      "\t.p2align 3",
      `\t.globl ${entry(fn)}`,
      `\t.hidden ${entry(fn)}`,
      `\t.type ${entry(fn)},@object`,
      `\t.size ${entry(fn)},24`,
      `${entry(fn)}:`,
      "\t.quad 0",
      `\t.quad .Llibrary${index}`,
      `\t.quad .Lsymbol${index}`,
    ]),
    '\t.section .note.GNU-stack,"",@progbits',
    "",
  ].join("\n"),
);

// ---- the check for a Windows machine ----

const check: string[] = [
  "// Written by misctools/portable/loop/uv_header.ts. Do not edit.",
  "//",
  "// Compiled on a Windows machine, against the headers of the Windows SDK and of libuv:",
  "//   clang -fsyntax-only -I<libuv>\\include check_on_windows.c",
  "// Every line that fails names a declaration of bun_windows_c.h that is not what Windows has.",
  "#include <winsock2.h>",
  "#include <ws2tcpip.h>",
  "#include <mstcpip.h>",
  "#include <afunix.h>",
  "#include <windows.h>",
  "#include <errno.h>",
  "#include <stddef.h>",
  "#include <uv.h>",
  "",
  "// A constant is 32 bits wide, with or without a sign: that is what is compared.",
  "#define SAME(name, value) _Static_assert((unsigned)(name) == (unsigned)(value), #name)",
  '_Static_assert(sizeof(SOCKET) == 8 && sizeof(HANDLE) == 8 && sizeof(DWORD) == 4 && sizeof(socklen_t) == 4, "the scalar types");',
  '_Static_assert(INVALID_SOCKET == ~0ull, "INVALID_SOCKET");',
  "SAME(TCP_INITIAL_RTO_UNSPECIFIED_RTT, 0xffff);",
  "SAME(TCP_INITIAL_RTO_NO_SYN_RETRANSMISSIONS, 0xfe);",
];
for (const [name, value] of constants) check.push(`SAME(${name}, ${value});`);
for (const [name, value] of errnos) check.push(`SAME(${name}, ${value});`);
for (const [name, value] of Object.entries(uvConstants)) check.push(`SAME(${name}, ${value});`);
const sizes = new Map<string, { size: number; offsets: [string, number][] }>();
{
  // The sizes and offsets of the tables, as the compiler of the image has them: asked of clang.
  const probe = [`#include "bun_windows_c.h"`, "#include <stdio.h>", "int main(void) {"];
  for (const { name, fields } of structs) {
    probe.push(`  printf("${name}|%zu", sizeof(${name}));`);
    for (const field of fields) probe.push(`  printf("|${field}=%zu", offsetof(${name}, ${field}));`);
    probe.push(`  printf("\\n");`);
  }
  probe.push("  return 0;", "}");
  const source = join(out, "probe.c");
  const program = join(out, "probe");
  writeFileSync(source, probe.join("\n") + "\n");
  const compiled = Bun.spawnSync(["cc", "-I", out, "-o", program, source], { stderr: "inherit" });
  if (compiled.exitCode !== 0) throw new Error("the probe of the structures does not compile");
  const ran = Bun.spawnSync([program], { stdout: "pipe" });
  for (const line of ran.stdout.toString().split("\n").filter(Boolean)) {
    const [name, size, ...offsets] = line.split("|");
    sizes.set(name, { size: Number(size), offsets: offsets.map(part => part.split("=") as [string, string]).map(([field, offset]) => [field, Number(offset)]) });
  }
  for (const path of [source, program]) Bun.spawnSync(["rm", "-f", path]);
}
for (const { name } of structs) {
  const known = sizes.get(name)!;
  check.push(`_Static_assert(sizeof(${name}) == ${known.size}, "${name}");`);
  for (const [field, offset] of known.offsets) check.push(`_Static_assert(offsetof(${name}, ${field}) == ${offset}, "${name}.${field}");`);
}
for (const [name, typed] of Object.entries(uvStructs)) {
  const fact = facts[name];
  check.push(`_Static_assert(sizeof(${name}) == ${fact.size} && _Alignof(${name}) == ${fact.align}, "${name}");`);
  for (const field of Object.keys(typed)) check.push(`_Static_assert(offsetof(${name}, ${field}) == ${fact.fields[field].offset}, "${name}.${field}");`);
}
check.push(
  "",
  "// The functions: each one has to be declared by these headers. The comment is the type that",
  "// bun_windows_c.h calls it with, for the eye: the compiler does not compare it.",
);
for (const fn of functions) {
  // _errno is the C runtime's, and uv__winsock_ensure is in no header of libuv: bun's C declares it itself.
  if (fn.library === "ucrtbase" || fn.name.startsWith("uv__")) continue;
  const types = fn.parameters.map(([type]) => type).join(", ") || "void";
  check.push(`static void *bun_check_${fn.name} = (void *)${fn.name};`, `// ${fn.library}: ${fn.returns} ${fn.name}(${types})`);
}
check.push("int main(void) { return 0; }", "");
writeFileSync(join(out, "check_on_windows.c"), check.join("\n"));

// ---- the same for the functions, by the compiler ----

/** A callback of libuv as bun_windows_c.h declares it, as the type of a function. */
function callbackType(name: string): string {
  const found = new RegExp(`\\bpub(?:\\(crate\\))? type ${name} =\\s*Option<unsafe extern "C" fn\\(([^)]*)\\)>;`).exec(libuvSource)!;
  return `void(${found[1].split(",").map(part => cType(part)).join(", ")})`;
}
const signatures: string[] = [
  "// Written by misctools/portable/loop/uv_header.ts. Do not edit.",
  "//",
  "// Compiled against the headers of the Windows SDK and of libuv:",
  "//   clang++ -fsyntax-only -std=c++17 -I<libuv>\\include check_on_windows.cpp",
  "// Every line that fails names a function that bun_windows_c.h calls with other arguments than the",
  "// headers declare, or a callback that it declares with others.",
  "#include <winsock2.h>",
  "#include <ws2tcpip.h>",
  "#include <mstcpip.h>",
  "#include <afunix.h>",
  "#include <windows.h>",
  "#include <stdint.h>",
  "#include <uv.h>",
  "",
  "// What the calling convention sees of a type: its width, whether it is a pointer, and for a pointer",
  "// what it points at. Two integers of one width are the same (a long of Windows and an int32_t), and",
  "// so are an enumeration and the integer of its width. A pointer to void is the same as every pointer",
  "// to data.",
  "template <class T> struct Shape {",
  "  static constexpr bool pointer = false, function = false, nothing = __is_void(T), floating = __is_floating_point(T);",
  "  static constexpr unsigned long long size = sizeof(T);",
  "};",
  "template <> struct Shape<void> {",
  "  static constexpr bool pointer = false, function = false, nothing = true, floating = false;",
  "  static constexpr unsigned long long size = 0;",
  "};",
  "template <class R, class... A> struct Shape<R(A...)> {",
  "  static constexpr bool pointer = false, function = true, nothing = false, floating = false;",
  "  static constexpr unsigned long long size = 0;",
  "};",
  "template <class T> struct Shape<T *> {",
  "  static constexpr bool pointer = true, function = false, nothing = false, floating = false;",
  "  static constexpr unsigned long long size = sizeof(T *);",
  "};",
  "template <class T> struct Shape<const T> : Shape<T> {};",
  "template <class T> struct Shape<volatile T> : Shape<T> {};",
  "template <class T> struct Shape<const volatile T> : Shape<T> {};",
  "",
  "template <class A, class B> struct Same;",
  "template <class A, class B> struct SamePointee {",
  "  static constexpr bool value = Shape<A>::nothing || Shape<B>::nothing || (!Shape<A>::function && !Shape<B>::function && Same<A, B>::value);",
  "};",
  "template <class R, class... A, class S, class... B> struct SamePointee<R(A...), S(B...)> {",
  "  static constexpr bool value = Same<R(A...), S(B...)>::value;",
  "};",
  "template <class A, class B> struct SamePointee<const A, B> : SamePointee<A, B> {};",
  "template <class A, class B> struct SamePointee<A, const B> : SamePointee<A, B> {};",
  "template <class A, class B> struct SamePointee<const A, const B> : SamePointee<A, B> {};",
  "template <class A, class B> struct Same {",
  "  static constexpr bool value = !Shape<A>::pointer && !Shape<B>::pointer && Shape<A>::nothing == Shape<B>::nothing &&",
  "                                Shape<A>::floating == Shape<B>::floating && Shape<A>::size == Shape<B>::size;",
  "};",
  "template <class A, class B> struct Same<A *, B *> {",
  "  static constexpr bool value = SamePointee<A, B>::value;",
  "};",
  "template <class A, class B> struct Same<const A, B> : Same<A, B> {};",
  "template <class A, class B> struct Same<A, const B> : Same<A, B> {};",
  "template <class A, class B> struct Same<const A, const B> : Same<A, B> {};",
  "template <class... A> struct List {};",
  "template <class A, class B> struct SameList {",
  "  static constexpr bool value = false;",
  "};",
  "template <> struct SameList<List<>, List<>> {",
  "  static constexpr bool value = true;",
  "};",
  "template <class A, class... As, class B, class... Bs> struct SameList<List<A, As...>, List<B, Bs...>> {",
  "  static constexpr bool value = Same<A, B>::value && SameList<List<As...>, List<Bs...>>::value;",
  "};",
  "template <class R, class... A, class S, class... B> struct Same<R(A...), S(B...)> {",
  "  static constexpr bool value = Same<R, S>::value && SameList<List<A...>, List<B...>>::value;",
  "};",
  "",
  "// The machinery tells a difference.",
  'static_assert(Same<int(long, void *), int32_t(int32_t, char *)>::value, "a long of Windows is an int32_t");',
  'static_assert(!Same<int(long), int(long long)>::value, "the width of an argument");',
  'static_assert(!Same<int(long), int(long, long)>::value, "the number of the arguments");',
  'static_assert(!Same<int(unsigned long *), int(unsigned long long *)>::value, "the width of what a pointer points at");',
  'static_assert(!Same<int(void *), int(uintptr_t)>::value, "a pointer and an integer");',
  'static_assert(!Same<void(void (*)(int)), void(void (*)(int, int))>::value, "the arguments of a callback");',
  'static_assert(!Same<void(int), int(int)>::value, "the result");',
  "",
];
for (const fn of functions) {
  if (fn.library === "ucrtbase" || fn.name.startsWith("uv__")) continue;
  const types = fn.parameters.map(([type]) => type).join(", ");
  signatures.push(`static_assert(Same<decltype(${fn.name}), ${fn.returns}(${types})>::value, "${fn.library}: ${fn.name}");`);
}
for (const name of uvCallbacks) signatures.push(`static_assert(Same<${name}, ${callbackType(name).replace("(", "(*)(")}>::value, "${name}");`);
signatures.push("int main() { return 0; }", "");
writeFileSync(join(out, "check_on_windows.cpp"), signatures.join("\n"));

writeFileSync(
  join(out, "declared.json"),
  JSON.stringify(
    {
      functions: functions.map(fn => ({ library: fn.library, symbol: fn.name })),
      structures_of_libuv: Object.fromEntries(Object.keys(uvStructs).map(name => [name, { size: facts[name].size, align: facts[name].align }])),
      callbacks: uvCallbacks,
    },
    null,
    1,
  ) + "\n",
);
console.log(`${out}: ${functions.length} functions, ${constants.length + errnos.length + Object.keys(uvConstants).length} constants, ${structs.length + Object.keys(uvStructs).length} structures`);
