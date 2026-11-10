import { count, bump, get } from "made-up-pkg";
export const seen = () => [count, bump(), count, get()].join();
