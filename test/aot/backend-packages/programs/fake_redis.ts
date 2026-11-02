import net from "node:net";

const bulk = (text: string | null, protocol = 2): string => (text === null ? (protocol === 3 ? "_\r\n" : "$-1\r\n") : `$${Buffer.byteLength(text)}\r\n${text}\r\n`);
const array = (items: string[]): string => `*${items.length}\r\n` + items.join("");

function parse(text: string): { words: string[]; rest: string } | null {
  if (!text.startsWith("*")) return null;
  let at = text.indexOf("\r\n");
  if (at < 0) return null;
  const count = Number(text.slice(1, at));
  at += 2;
  const words: string[] = [];
  for (let i = 0; i < count; i++) {
    const end = text.indexOf("\r\n", at);
    if (end < 0) return null;
    const length = Number(text.slice(at + 1, end));
    if (text.length < end + 2 + length + 2) return null;
    words.push(text.slice(end + 2, end + 2 + length));
    at = end + 2 + length + 2;
  }
  return { words, rest: text.slice(at) };
}

export function fakeRedis(seen: string[]): net.Server {
  const strings = new Map<string, string>();
  const hashes = new Map<string, Map<string, string>>();
  const run = (words: string[], protocol: number): string => {
    const key = words[1] ?? "";
    switch (words[0]!.toUpperCase()) {
      case "PING": return "+PONG\r\n";
      case "SET": strings.set(key, words[2]!); return "+OK\r\n";
      case "GET": return bulk(strings.get(key) ?? null, protocol);
      case "DEL": return `:${strings.delete(key) ? 1 : 0}\r\n`;
      case "INCR": { const n = Number(strings.get(key) ?? "0") + 1; strings.set(key, String(n)); return `:${n}\r\n`; }
      case "HSET": {
        const hash = hashes.get(key) ?? new Map<string, string>();
        hashes.set(key, hash);
        let added = 0;
        for (let i = 2; i + 1 < words.length; i += 2) { if (!hash.has(words[i]!)) added++; hash.set(words[i]!, words[i + 1]!); }
        return `:${added}\r\n`;
      }
      case "HGETALL": {
        const pairs = [...(hashes.get(key) ?? new Map<string, string>())].flatMap(([k, v]) => [bulk(k), bulk(v)]);
        return protocol === 3 ? `%${pairs.length / 2}\r\n` + pairs.join("") : array(pairs);
      }
      case "INFO": return bulk("# Server\r\nredis_version:7.2.0\r\nloading:0\r\n");
      case "HELLO": {
        const pairs = [bulk("server"), bulk("redis"), bulk("version"), bulk("7.2.0"), bulk("proto"), `:${protocol}\r\n`, bulk("id"), ":1\r\n", bulk("mode"), bulk("standalone"), bulk("role"), bulk("master"), bulk("modules"), "*0\r\n"];
        return protocol === 3 ? `%${pairs.length / 2}\r\n` + pairs.join("") : array(pairs);
      }
      case "COMMAND": return "*0\r\n";
      default: return "+OK\r\n";
    }
  };
  return net.createServer(socket => {
    let pending = "";
    let queued: string[][] | null = null;
    let protocol = 2;
    socket.setEncoding("utf8");
    socket.on("error", () => {});
    socket.on("data", (chunk: string) => {
      pending += chunk;
      for (;;) {
        const parsed = parse(pending);
        if (!parsed) return;
        pending = parsed.rest;
        const command = parsed.words[0]!.toUpperCase();
        if (!["INFO", "CLIENT", "HELLO", "SELECT", "COMMAND"].includes(command)) seen.push(parsed.words.join(" "));
        if (command === "HELLO" && parsed.words[1] === "3") protocol = 3;
        if (command === "MULTI") { queued = []; socket.write("+OK\r\n"); }
        else if (command === "EXEC") { const all = queued ?? []; queued = null; socket.write(array(all.map(words => run(words, protocol)))); }
        else if (queued) { queued.push(parsed.words); socket.write("+QUEUED\r\n"); }
        else if (command === "QUIT") { socket.end("+OK\r\n"); return; }
        else socket.write(run(parsed.words, protocol));
      }
    });
  });
}
