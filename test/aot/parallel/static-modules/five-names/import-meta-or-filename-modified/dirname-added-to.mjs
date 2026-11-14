import.meta.dirname += "/other";
export default (await import(`${import.meta.dirname}/a.js`)).default;
