export const load = name => import(new URL(`../../texts/${name}.json`, import.meta.url).href);
