// The two patterns that the library holds addresses against are written out (src/js/internal/net/isIP.ts). A build compiles a pattern that is written, and works out no text for the library:
// put together of parts, as node has them, both were parsed and compiled when the program ran.
// COUNTER: RegExpsCreatedWithoutRecord = 0
import net from "node:net";
const cases = ["1.2.3.4", "255.255.255.255", "256.1.1.1", "01.2.3.4", "1.2.3", "1.2.3.4.5", "", " 1.2.3.4", "::", "::1", "1::", "1:2:3:4:5:6:7:8", "1:2:3:4:5:6:7:8:9", "1:2:3:4:5:6:1.2.3.4", "::ffff:1.2.3.4", "::ffff:256.2.3.4", "fe80::1%eth0", "fe80::1%", "g::1", "1::2::3", "12345::", "::1.2.3.4", "1:2:3:4:5:6:7::", "::2:3:4:5:6:7:8", null, undefined, 4, {}, "1.2.3.4\n", "0:0:0:0:0:0:0:0", "2001:db8::8a2e:370:7334%a-b.c:d"];
for (const value of cases) console.log(JSON.stringify(value), net.isIP(value), net.isIPv4(value), net.isIPv6(value));
