"use client";
export default function Failed({ error }: { error: Error }) {
  return <p>the boundary caught {error.name}</p>;
}
