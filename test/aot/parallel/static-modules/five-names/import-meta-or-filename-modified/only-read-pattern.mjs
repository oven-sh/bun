const { dir, url } = import.meta;
export default url.endsWith(".mjs") && dir === import.meta.dirname && (await import(`${import.meta.dirname}/a.js`)).default;
