import { error } from "@sveltejs/kit";

export const load = () => error(418, { message: "a teapot" });
