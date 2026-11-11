if (!process.env.K123_URL) throw new Error("K123_URL is not set");
export const url = process.env.K123_URL;
