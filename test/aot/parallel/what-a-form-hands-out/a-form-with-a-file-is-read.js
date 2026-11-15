// A part with a file name is a File.
const body =
  '--made\r\nContent-Disposition: form-data; name="a"; filename="a.txt"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--made--\r\n';
const form = await new Response(body, { headers: { "content-type": "multipart/form-data; boundary=made" } }).formData();
const file = form.get("a");
console.log(
  `${file.name} ${file.size} ${file.type} ${await file.text()} ${file instanceof File} ${form instanceof FormData}`,
);
for (const [name, value] of form) console.log(`${name} ${typeof value}`);
