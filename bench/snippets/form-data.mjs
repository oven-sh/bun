// so it can run in environments without node module resolution
import { bench, run } from "../runner.mjs";

const blob = new Blob(["foo", "bar", "baz"]);
bench("FormData.append", () => {
  const data = new FormData();
  data.append("foo", "bar");
  data.append("baz", blob);
});

const data = new FormData();
data.append("foo", "bar");
data.append("baz", blob);

const formText =
  // single field form data
  "--Form\r\n" + 'Content-Disposition: form-data; name="foo"\r\n\r\n' + "bar\r\n" + "--Form--\r\n";

bench("response.formData()", async () => {
  await new Response(formText, {
    headers: {
      "Content-Type": "multipart/form-data; boundary=Form",
    },
  }).formData();
});
bench("new Response(formData).text()", async () => {
  await new Response(data).text();
});

bench("new Response(formData).formData()", async () => {
  await new Response(data).formData();
});

const files = new FormData();
for (let i = 0; i < 16; i++) files.append("file", new File(["foo"], "foo.txt"));
// Held, so that each read returns the same File.
const held = files.getAll("file");

bench("formData.get(string)", () => data.get("foo"));
bench("formData.get(file)", () => files.get("file"));
bench("formData.getAll(file) x16", () => files.getAll("file"));

await run();
