// What the compiler reads in place of src/js/internal/net/isIP.ts, which `bun run` evaluates. The two do the same.
// Written against that file with the SHA-256 afd9632f8708493915bcf780cc21b12f01fab4b2bb80ce479a58d16786fef788.
// When that file changes, bring the change here and write the new hash: test/internal/second-texts-of-modules.test.ts.
// Both patterns are written out. An ahead-of-time build compiles a pattern that is written, and works out no text for the library.
// They are node's (lib/internal/net.js), put together of
//   v4Seg = (?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])   v4Str = (?:v4Seg\.){3}v4Seg   v6Seg = (?:[0-9a-fA-F]{1,4})
//   IPv4: ^v4Str$
//   IPv6: ^(?:(?:v6Seg:){7}(?:v6Seg|:)|(?:v6Seg:){6}(?:v4Str|:v6Seg|:)|(?:v6Seg:){5}(?::v4Str|(?::v6Seg){1,2}|:)|(?:v6Seg:){4}(?:(?::v6Seg){0,1}:v4Str|(?::v6Seg){1,3}|:)|
//         (?:v6Seg:){3}(?:(?::v6Seg){0,2}:v4Str|(?::v6Seg){1,4}|:)|(?:v6Seg:){2}(?:(?::v6Seg){0,3}:v4Str|(?::v6Seg){1,5}|:)|(?:v6Seg:){1}(?:(?::v6Seg){0,4}:v4Str|(?::v6Seg){1,6}|:)|
//         (?::(?:(?::v6Seg){0,5}:v4Str|(?::v6Seg){1,7}|:)))(?:%[0-9a-zA-Z-.:]{1,})?$
const IPv4Reg =
  /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
// prettier-ignore
const IPv6Reg = /^(?:(?:(?:[0-9a-fA-F]{1,4}):){7}(?:(?:[0-9a-fA-F]{1,4})|:)|(?:(?:[0-9a-fA-F]{1,4}):){6}(?:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|:(?:[0-9a-fA-F]{1,4})|:)|(?:(?:[0-9a-fA-F]{1,4}):){5}(?::(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|(?::(?:[0-9a-fA-F]{1,4})){1,2}|:)|(?:(?:[0-9a-fA-F]{1,4}):){4}(?:(?::(?:[0-9a-fA-F]{1,4})){0,1}:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|(?::(?:[0-9a-fA-F]{1,4})){1,3}|:)|(?:(?:[0-9a-fA-F]{1,4}):){3}(?:(?::(?:[0-9a-fA-F]{1,4})){0,2}:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|(?::(?:[0-9a-fA-F]{1,4})){1,4}|:)|(?:(?:[0-9a-fA-F]{1,4}):){2}(?:(?::(?:[0-9a-fA-F]{1,4})){0,3}:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|(?::(?:[0-9a-fA-F]{1,4})){1,5}|:)|(?:(?:[0-9a-fA-F]{1,4}):){1}(?:(?::(?:[0-9a-fA-F]{1,4})){0,4}:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|(?::(?:[0-9a-fA-F]{1,4})){1,6}|:)|(?::(?:(?::(?:[0-9a-fA-F]{1,4})){0,5}:(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])|(?::(?:[0-9a-fA-F]{1,4})){1,7}|:)))(?:%[0-9a-zA-Z-.:]{1,})?$/;

// Whatever is no string is no address: `test` reads it as text.
function isIPv4(s: string | null | undefined) {
  return IPv4Reg.test(s!);
}

function isIPv6(s: string | null | undefined) {
  return IPv6Reg.test(s!);
}

function isIP(s: string | null | undefined): 0 | 4 | 6 {
  if (isIPv4(s)) return 4;
  if (isIPv6(s)) return 6;
  return 0;
}

export default {
  isIPv4,
  isIPv6,
  isIP,
};
