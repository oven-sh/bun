import sharp from "sharp";

const raw = Buffer.alloc(16 * 16 * 3);
for (let i = 0; i < raw.length; i++) raw[i] = (i * 7) % 256;
const png = await sharp(raw, { raw: { width: 16, height: 16, channels: 3 } }).resize(8, 8, { kernel: "nearest" }).png().toBuffer();
const metadata = await sharp(png).metadata();
console.log(metadata.format, metadata.width, metadata.height, metadata.channels, png.subarray(1, 4).toString());
console.log([...(await sharp(png).raw().toBuffer()).subarray(0, 6)].join());
console.log("DONE");
