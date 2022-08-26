import { readFileSync } from "fs";
import { resolve } from "path";

export function dataURI(expr) {
  const [pathNode, relativeNode] = expr.arguments;
  const path = pathNode.toString();
  const relative = relativeNode.toString();
  try {
    const toLoad = resolve(process.cwd(), relative, "../", path);
    const data = readFileSync(toLoad);

    return `data:${Bun.file(toLoad).type};base64, ${btoa(
      String.fromCharCode(...new Uint8Array(data.buffer))
    )}`;
  } catch (e) {
    console.error(e);
    return "";
  }
}
