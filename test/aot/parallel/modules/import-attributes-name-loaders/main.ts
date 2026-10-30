import first from "./first.bin" with { type: "file" };
import second from "./sub/second.bin" with { type: "file" };
import settings from "./settings.conf" with { type: "json" };
import note from "./note.tpl" with { type: "text" };
const path: string = first;
const port: number = settings.port;
console.log(first === second, path.endsWith(".bin"), port + 1, settings.hosts.map(host => host.length).join(), note.trim());
