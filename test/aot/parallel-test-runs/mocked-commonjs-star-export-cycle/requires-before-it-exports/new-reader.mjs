import * as hub from "kit/hub.mjs";
export const look = () =>
  Object.keys(hub)
    .sort()
    .map(key => key + "=" + String(hub[key]))
    .join();
