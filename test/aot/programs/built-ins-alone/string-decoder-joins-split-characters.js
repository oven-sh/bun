import { StringDecoder } from "node:string_decoder";
const decoder = new StringDecoder("utf8");
console.log(decoder.write(Buffer.from([0xe2, 0x82])).length, decoder.write(Buffer.from([0xac])), decoder.end().length);
