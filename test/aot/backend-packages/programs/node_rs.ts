import { hash as argon2Hash, verify as argon2Verify } from "@node-rs/argon2";
import { compareSync, hashSync } from "@node-rs/bcrypt";

const hashed = await argon2Hash("password", { salt: Buffer.alloc(16, 7), timeCost: 2, memoryCost: 1024, parallelism: 1 });
console.log(hashed, await argon2Verify(hashed, "password"), await argon2Verify(hashed, "other"));
const crypted = hashSync("password", { cost: 6 });
console.log(crypted.slice(0, 7), compareSync("password", crypted), compareSync("other", crypted));
console.log("DONE");
