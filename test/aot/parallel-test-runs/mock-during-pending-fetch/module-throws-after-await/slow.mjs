export const get = () => "real";
await new Promise(done => setTimeout(done, 20));
throw new Error("slow");
