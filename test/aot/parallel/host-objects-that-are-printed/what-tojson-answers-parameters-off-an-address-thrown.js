// Exit code: 1
const params = new URL("http://made.up/?a=b").searchParams; params.toJSON = () => new URL("http://made.up/"); console.log("before"); throw params;
