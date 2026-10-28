// The date getters of fs.Stats cache the Date on the receiver: an instance of a subclass, or a class object below a Stats object.
import { statSync, Stats } from "node:fs";
class S extends Stats { atime = 1; read() { return [typeof this.atime, typeof this.mtime]; } }
const s = new S();
console.log(JSON.stringify([s.read(), Object.keys(s).includes("mtime")]));
class A { static mtime = 1; static mtimeMs = 5; static z = 2; static read() { return [typeof A.mtime, A.z]; } }
Object.setPrototypeOf(A, statSync("."));
console.log(JSON.stringify([A.read(), typeof A.ctime, Object.keys(A)]));
class B { static z = 2; static read() { return [typeof B.mtime, B.z]; } }
Object.setPrototypeOf(B, Stats.prototype);
console.log(JSON.stringify([B.read(), Object.keys(B)]));
