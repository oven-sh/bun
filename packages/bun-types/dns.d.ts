declare module "dns" {
  /**
   * Lookup the IP address for a hostname
   *
   * Uses non-blocking APIs by default
   *
   * @param hostname The hostname to lookup
   * @param options Options for the lookup
   *
   * ## Example
   *
   * ```js
   * const {address} = await Bun.dns.lookup('example.com');
   * ```
   *
   * ### Filter results to IPv4:
   *
   * ```js
   * import {dns} from 'bun';
   * const {address} = await dns.lookup('example.com', {family: 4});
   * console.log(address); // "123.122.22.126"
   * ```
   *
   * ### Filter results to IPv6:
   *
   * ```js
   * import {dns} from 'bun';
   * const {address} = await dns.lookup('example.com', {family: 6});
   * console.log(address); // "2001:db8::1"
   * ```
   *
   * #### DNS resolver client
   *
   * Bun supports three DNS resolvers:
   * - `c-ares` - Uses the c-ares library to perform DNS resolution. This is the default on Linux.
   * - `system` - Uses the system's non-blocking DNS resolver API if available, falls back to `getaddrinfo`. This is the default on macOS and the same as `getaddrinfo` on Linux.
   * - `getaddrinfo` - Uses the posix standard `getaddrinfo` function. Will cause performance issues under concurrent loads.
   *
   * To customize the DNS resolver, pass a `backend` option to `dns.lookup`:
   * ```js
   * import {dns} from 'bun';
   * const {address} = await dns.lookup('example.com', {backend: 'getaddrinfo'});
   * console.log(address); // "19.42.52.62"
   * ```
   */
  function lookup(
    hostname: string,
    options?: {
      /**
       * Limit results to either IPv4, IPv6, or both
       */
      family?: 4 | 6 | 0 | "IPv4" | "IPv6" | "any";
      /**
       * Limit results to either UDP or TCP
       */
      socketType?: "udp" | "tcp";
      flags?: number;
      port?: number;

      /**
       * The DNS resolver implementation to use
       *
       * Defaults to `"c-ares"` on Linux and `"system"` on macOS. This default
       * may change in a future version of Bun if c-ares is not reliable
       * enough.
       *
       * On macOS, `system` uses the builtin macOS [non-blocking DNS
       * resolution
       * API](https://opensource.apple.com/source/Libinfo/Libinfo-222.1/lookup.subproj/netdb_async.h.auto.html).
       *
       * On Linux, `system` is the same as `getaddrinfo`.
       *
       * `c-ares` is more performant on Linux in some high concurrency
       * situations, but it lacks support support for mDNS (`*.local`,
       * `*.localhost` domains) along with some other advanced features. If
       * you run into issues using `c-ares`, you should try `system`. If the
       * hostname ends with `.local` or `.localhost`, Bun will automatically
       * use `system` instead of `c-ares`.
       *
       * [`getaddrinfo`](https://man7.org/linux/man-pages/man3/getaddrinfo.3.html)
       * is the POSIX standard function for blocking DNS resolution. Bun runs
       * it in Bun's thread pool, which is limited to `cpus / 2`. That means
       * if you run a lot of concurrent DNS lookups, concurrent IO will
       * potentially pause until the DNS lookups are done.
       *
       * On macOS, it shouldn't be necessary to use "`getaddrinfo`" because
       * `"system"` uses the same API underneath (except non-blocking).
       *
       */
      backend?: "c-ares" | "system" | "getaddrinfo";
    },
  ): Promise<DNSLookup[]>;
}

declare module "node:dns" {
  export * from "dns";
}

interface DNSLookup {
  /**
   * The IP address of the host as a string in IPv4 or IPv6 format.
   *
   * @example "127.0.0.1"
   * @example "192.168.0.1"
   * @example "2001:4860:4860::8888"
   */
  address: string;
  family: 4 | 6;

  /**
   * Time to live in seconds
   *
   * Only supported when using the `c-ares` DNS resolver via "backend" option
   * to {@link dns.lookup}. Otherwise, it's 0.
   */
  ttl: number;
}
