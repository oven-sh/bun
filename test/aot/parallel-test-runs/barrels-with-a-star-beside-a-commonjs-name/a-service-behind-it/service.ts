import { send } from "./barrel.ts";

export const notify = () => "notified: " + send();
