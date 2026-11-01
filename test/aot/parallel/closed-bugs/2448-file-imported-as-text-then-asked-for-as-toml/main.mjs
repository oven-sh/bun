import raw from "./c.toml" with { type: "text" };
import parsed from "./c.toml";
async function loadAs(type) { return (await import("./c.toml", { with: { type } })).default; }
console.log(JSON.stringify(await loadAs("toml")), JSON.stringify(parsed), JSON.stringify(raw));
