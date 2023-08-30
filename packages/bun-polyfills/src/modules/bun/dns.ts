import dns from 'node:dns';

const dnsObj: typeof Bun.dns = {
    async lookup(hostname, options) {
        const opts = { verbatim: true, all: true } as dns.LookupOptions;
        if (options?.family) {
            if (options.family === 'IPv4') opts.family = 4;
            else if (options.family === 'IPv6') opts.family = 6;
            else if (options.family === 'any') opts.family = 0;
            else opts.family = options.family;
        }
        if (options?.flags) opts.hints = options.flags;
        const records = ((await dns.promises.resolveAny(hostname))
            .filter(r => r.type === 'A' || r.type === 'AAAA') as (dns.AnyARecord | dns.AnyAaaaRecord)[])
            .map(r => ({ address: r.address, family: r.type === 'A' ? 4 as const : 6 as const, ttl: r.ttl }));
        return records;
    },
    // This has more properties but they're not documented on bun-types yet, oh well.
};

export default dnsObj;
