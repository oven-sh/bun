// The goal of this stream is for this code to work.
// The likelihood of that happening is pretty low.
// but it's worth an attempt!
const canvas = new OffscreenCanvas(256, 256);
const ctx = canvas.getContext("2d");

const imageData = new ImageData(256, 256);
// one red pixel
imageData.data[0] = 255;
imageData.data[1] = 0;
imageData.data[2] = 0;

console.log(imageData);

// ctx.drawImage(imageData, 0, 0);

// const blob = await canvas.convertToBlob({ type: "image/png" });
// await Bun.write("hello.png", blob);

// export {};
