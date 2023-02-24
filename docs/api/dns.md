Bun implements the `node:dns` module.

```ts
import * as dns from "node:dns";

const addrs = await dns.promises.resolve4("bun.sh", { ttl: true });
console.log(addrs);
// => [{ address: "172.67.161.226", family: 4, ttl: 0 }, ...]
```

<!--
## `Bun.dns` - lookup a domain
`Bun.dns` includes utilities to make DNS requests, similar to `node:dns`. As of Bun v0.5.0, the only implemented function is `dns.lookup`, though more will be implemented soon.
You can lookup the IP addresses of a hostname by using `dns.lookup`.
```ts
import { dns } from "bun";
const [{ address }] = await dns.lookup("example.com");
console.log(address); // "93.184.216.34"
```
If you need to limit IP addresses to either IPv4 or IPv6, you can specify the `family` as an option.
```ts
import { dns } from "bun";
const [{ address }] = await dns.lookup("example.com", { family: 6 });
console.log(address); // "2606:2800:220:1:248:1893:25c8:1946"
```
Bun supports three backends for DNS resolution:
- `c-ares` - This is the default on Linux, and it uses the [c-ares](https://c-ares.org/) library to perform DNS resolution.
- `system` - Uses the system's non-blocking DNS resolver, if available. Otherwise, falls back to `getaddrinfo`. This is the default on macOS, and the same as `getaddrinfo` on Linux.
- `getaddrinfo` - Uses the POSIX standard `getaddrinfo` function, which may cause performance issues under concurrent load.

You can choose a particular backend by specifying `backend` as an option.
```ts
import { dns } from "bun";
const [{ address, ttl }] = await dns.lookup("example.com", {
  backend: "c-ares"
});
console.log(address); // "93.184.216.34"
console.log(ttl); // 21237
```
Note: the `ttl` property is only accurate when the `backend` is c-ares. Otherwise, `ttl` will be `0`.
This was added in Bun v0.5.0. -->
