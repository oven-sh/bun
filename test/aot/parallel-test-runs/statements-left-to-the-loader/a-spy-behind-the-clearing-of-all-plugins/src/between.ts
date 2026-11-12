import { who as inner } from "./origin";
export { inner as who };
export const own = () => inner();
