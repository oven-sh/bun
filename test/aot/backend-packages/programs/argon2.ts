import argon2 from "argon2";
import { timed } from "./lib_http.ts";

const hash = await timed("native", () => argon2.hash("password", { salt: Buffer.alloc(16, 7), timeCost: 2, memoryCost: 1024, parallelism: 1 }));
console.log(hash);
console.log(await argon2.verify(hash, "password"), await argon2.verify(hash, "other"), argon2.needsRehash(hash, { timeCost: 3 }));
console.log("DONE");
