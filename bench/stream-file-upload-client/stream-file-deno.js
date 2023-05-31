const file = await Deno.open(Deno.env.get("FILE") ?? "hello.txt", {
  read: true,
});

console.time("stream-file-deno");
const response = await fetch(Deno.env.get("URL"), {
  method: "POST",
  body: file.readable,
});
console.timeEnd("stream-file-deno");

console.log("Sent", await response.text(), "bytes");
