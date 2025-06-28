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

await run();
