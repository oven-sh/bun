---
name: Build an app with Diploi and Bun
---

Diploi is a development and deployment platform that allows users to create applications and host them online in seconds.

Bun is supported natively in Diploi, and you can launch Bun apps with a database from [diploi.com/component/bun](https://diploi.com/component/bun) or if you want to add frontend, you can combine Bun with other tools using [Diploi's Stack Builder](diploi.com/#StackBuilder)

---

Let's deploy a fullstack application using Bun for the backend and React-Vite for the frontend with Postgres

---

Go to Diploi's Stack Builder.

<a href="https://diploi.com/#StackBuilder" target="_blank">diploi.com/#StackBuilder</a>

And there choose Bun, React+Vite, and Postgres. Once you are done, click "Launch Stack".

{% image src="https://github.com/diploi/media/blob/main/images/diploi-stack-builder.png?raw=true" /%}

---

That's pretty much it 🎉

Wait until the application development server is created and running.

{% image src="https://github.com/diploi/media/blob/main/images/diploi-creating-app.png?raw=true" /%}

---

Once your server is fully running, you can preview the app online and also start coding remotely using the browser IDE or connecting your local IDE via SSH.

Your application gets an SSL protected diploi.app URL by default, which you can customize or update to use your own domain.

{% image src="https://github.com/diploi/media/blob/main/images/diploi-server-running.png?raw=true" /%}
