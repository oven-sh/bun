import { error } from "@sveltejs/kit";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, url }) => {
  if (!/^\d+$/.test(params.id)) error(404, "no such person");
  return { id: Number(params.id), greeting: url.searchParams.get("greeting") ?? "nothing" };
};
