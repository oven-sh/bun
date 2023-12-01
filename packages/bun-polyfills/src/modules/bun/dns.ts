import type { DNSLookup } from 'bun';
import dns from 'node:dns';

const dnsObj: typeof Bun.dns = {
    async lookup(hostname, options) {
        const opts = { verbatim: true, all: true, family: 0, hints: 0 } as Required<dns.LookupOptions>;
        if (options?.family) {
            if (options.family === 'IPv4') opts.family = 4;
            else if (options.family === 'IPv6') opts.family = 6;
            else if (options.family === 'any') opts.family = 0;
            else opts.family = options.family;
        }
        if (options?.flags) opts.hints = options.flags;
        opts.hints |= dns.V4MAPPED;
        const records = await dns.promises.lookup(hostname, opts) as dns.LookupAddress[];
        return await Promise.all(records.map(async r => {
            const record = r as DNSLookup;
            try {
                record.ttl = ((await dns.promises[`resolve${record.family}`](hostname, { ttl: true })) as dns.RecordWithTtl[])
                    .find(r => r.address === record.address)?.ttl ?? 0;
            } catch {
                record.ttl = 0;
            }
            return record;
        }));
    },
    // This has more properties but they're not documented on bun-types yet, oh well.
};

export default dnsObj;
