// Import serve and file system modules
import { serve, file } from "bun";
serve({
  fetch(request) {
    // Search for the index.html file with the file system module
    const html = file("index.html");
    // Get url and method from request
    const { url, method } = request;
    const { pathname } = new URL(url);
    // Validate pathname and method
    if (pathname === "/" && method === "GET") {
      // render html file and return it
      return new Response(html, {
        status: 200, // set status code to 200
        headers: {
          "Content-Type": "text/html", // set content type to text/html
        },
      });
    }
  },
  port: 3000, // set port to 3000
});

console.log("Bun server is running on port 3000");