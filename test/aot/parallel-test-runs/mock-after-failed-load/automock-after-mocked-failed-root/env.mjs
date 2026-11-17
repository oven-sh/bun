if (!process.env.K86_URL) throw new Error("K86_URL is not set");
export const url = process.env.K86_URL;
