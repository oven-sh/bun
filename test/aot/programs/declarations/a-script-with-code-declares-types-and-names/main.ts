// What a script declares beside its code and `bun run` drops (an interface, `declare var`) is global for tsc and `bun check`.
import "./with-code";

const settings: Settings = { depth: 2 };
console.log(settings.depth, installed);
