"use client";

import { useEffect, useState } from "react";

interface User {
  id: number;
  name: string;
}

export default function Route() {
  const [name, setName] = useState("Testing");

  useEffect(() => {
    const id = setTimeout(() => {
      const userFromSomeAPI = JSON.parse('{"id": 1}') as User;

      const uppercaseFirst = userFromSomeAPI.name.charAt(0).toUpperCase() + userFromSomeAPI.name.slice(1);

      setName(uppercaseFirst);
    }, 2000);

    return () => {
      clearTimeout(id);
    };
  }, []);

  return <div>{name} 2</div>;
}
