import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
console.log(createHash("sha256").update("a").digest("hex").length, createHash("md5").update("a").digest().length + 1, createHmac("sha1", "key").update("a").digest("base64").length, randomBytes(4).length + 1, randomUUID().length, timingSafeEqual(Buffer.from("a"), Buffer.from("a")));
