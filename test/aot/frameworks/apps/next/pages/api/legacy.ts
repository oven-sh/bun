import type { NextApiRequest, NextApiResponse } from "next";

export default function handler(request: NextApiRequest, response: NextApiResponse) {
  response.setHeader("x-made-by", "pages api");
  response.status(request.method === "POST" ? 201 : 200).json({ method: request.method, query: request.query, body: request.body ?? null });
}
