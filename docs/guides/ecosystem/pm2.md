---
name: Run Bun as a daemon with PM2
---

[PM2](https://pm2.keymetrics.io/) is a popular process manager that manages and runs your applications as daemons (background processes).

It offers features like process monitoring, automatic restarts, and easy scaling. Using a process manager is common when deploying a Bun application on a cloud-hosted virtual private server (VPS), as it:

- Keeps your Node.js application running continuously.
- Ensure high availability and reliability of your application.
- Monitor and manage multiple processes with ease.
- Simplify the deployment process.

---

You can use PM2 with Bun in two ways: as a CLI option or in a configuration file.

### With `--interpreter`

---

To start your application with PM2 and Bun as the interpreter, open your terminal and run the following command:

```bash
pm2 start --interpreter ~/.bun/bin/bun index.ts
```

---

### With a configuration file

---

Alternatively, you can create a PM2 configuration file. Create a file named `pm2.config.js` in your project directory and add the following content.

```javascript
module.exports = {
  name: "app", // Name of your application
  script: "index.ts", // Entry point of your application
  interpreter: "bun", // Bun interpreter
  env: {
    PATH: `${process.env.HOME}/.bun/bin:${process.env.PATH}`, // Add "~/.bun/bin/bun" to PATH
  },
};
```

---

After saving the file, you can start your application with PM2

```bash
pm2 start pm2.config.js
```

---

That’s it! Your JavaScript/TypeScript web server is now running as a daemon with PM2 using Bun as the interpreter.
