// A class that a module exports only as a type is not a member of the module's namespace object.
import * as direct from "./sockets";
import * as through from "./index";
console.log(Object.keys(direct).sort().join(","));
console.log(Object.keys(through).sort().join(","));
console.log(Object.keys(await import("./sockets")).sort().join(","));
console.log("SocketMessage" in direct, (through as any).Third, new direct.Kept().text);
