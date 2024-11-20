"use client";


import { useState } from "react";

function App() {
	const [count, setCount] = useState(null);

	return (
		<>
      {/* @ts-expect-error */}
		  <button onClick={() => setCount(count => count.charAt(0))}>count is {count}</button>
		</>
	);
}

export default App;