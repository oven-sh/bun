import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => ({ now: "at once", later: new Promise<string>(resolve => setTimeout(() => resolve("streamed later"), 10)) });
