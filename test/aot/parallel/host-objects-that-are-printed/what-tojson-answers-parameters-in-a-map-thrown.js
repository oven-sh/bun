// Exit code: 1
const params = new URLSearchParams("a=b"); params.toJSON = () => new URL("http://made.up/"); console.log("before"); throw new Map([[1, params]]);
