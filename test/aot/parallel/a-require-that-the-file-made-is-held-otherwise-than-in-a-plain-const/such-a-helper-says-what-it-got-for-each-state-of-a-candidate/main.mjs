import { createRequire } from "node:module";
function tell(here, places) {
  const load = createRequire(here);
  for (const place of places) {
    let line = place + " ";
    try {
      const got = load(place);
      line += typeof got + " " + JSON.stringify(got);
    } catch (error) {
      line += "threw " + error.name;
    }
    console.log("SAID", line);
  }
}
tell(import.meta.url, ["./there.json", "./nothing.json", "./blank.json", "./mark.json", "./broken.json", "./null.json", "./list.json"]);
