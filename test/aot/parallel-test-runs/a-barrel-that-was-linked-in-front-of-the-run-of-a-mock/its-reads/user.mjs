import * as all from "tray/shelf.mjs";
export const look = () => [Reflect.get(all, "rim"), Reflect.get(all, "base")].map(String).join();
