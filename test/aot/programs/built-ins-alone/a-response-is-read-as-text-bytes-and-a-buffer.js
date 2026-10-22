console.log((await new Response("abc").text()).length, (await new Response("abc").bytes())[0] + 1, (await new Response("abc").arrayBuffer()).byteLength + 1);
