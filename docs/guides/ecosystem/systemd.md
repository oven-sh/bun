---
name: Run Bun as a daemon with systemd
---

[systemd](https://systemd.io) is a suite of basic building blocks for a Linux system. It provides a system and service manager that runs as PID 1 and starts the rest of the system.

systemd provides aggressive parallelization capabilities, uses socket and D-Bus activation for starting services, offers on-demand starting of daemons, keeps track of processes using Linux control groups, maintains mount and auto mount points, and implements an elaborate transactional dependency-based service control logic. systemd supports SysV and LSB init scripts and works as a replacement for sysvinit.

Other parts include a logging daemon, utilities to control basic system configuration like the hostname, date, locale, maintain a list of logged-in users and running containers and virtual machines, system accounts, runtime directories and settings, and daemons to manage simple network configuration, network time synchronization, log forwarding, and name resolution.

---

### The service file

---

To run the **bun** application using **systemd** you need to create the following file in `/lib/systemd/system/` and the file name must end in `.service`, e.g. `my-app.service` and the full path for this file will be `/lib/systemd/system/my-app.service`.

The service file contains:

- [Unit]
  - **Description** -> A description about your application
  - **After** -> by setting the value `network.target` the system will know to start your application after the network is available
- [Service]
  - **Type** -> In most cases you will use the `simple` type, but if you need a special case, you can find the rest of the types [here](https://www.freedesktop.org/software/systemd/man/systemd.service.html#Type=)
  - **User** -> Which user to use when starting the application, if you are using the ports 80 or 443, a normal user might not have permission to use those ports
  - **WorkingDirectory** -> This needs to be set to the root directory of your application
  - **ExecStart** -> Here you need to specify the executable and the file to start, in the case of bun, you need to point to the path `/home/YOUR_USER/.bun/bin/bun` because systemd will not know about bun.
  - **Restart** -> If set to **always** than the service will restart every time when the process is closed even on a clean exit, available options for this are: `no, on-success, on-failure, on-abnormal, on-watchdog, on-abort, always`
- [Install]
  - **WantedBy** -> multi-user.target normally defines a system state where all network services are started up and the system will accept logins. If you omit this part, the service will not start automatically unless another service has `Requires` or `Wants` that points to your service

```ini
[Unit]
Description=My App
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/home/YOUR_USER/application
ExecStart=/home/YOUR_USER/.bun/bin/bun run /home/YOUR_USER/application/dist/index.js
Restart=always

[Install]
WantedBy=multi-user.target
```

---

### Commands to start/stop/enable/restart your service

---

Now that you have your service file, you can start the file using the following command, **note** that this command requires **sudo** permissions. The name of the service is the name of the file

```bash
sudo systemctl start my-app
```

To check the status of your application use `status` instead of `start`

```bash
sudo systemctl status my-app
```

If the application started successfully you should see something like this:

```bash
● my-app.service - My App
     Loaded: loaded (/lib/systemd/system/my-app.service; enabled; preset: enabled)
     Active: active (running) since Thu 2023-10-12 11:34:08 UTC; 1h 8min ago
   Main PID: 309641 (bun)
      Tasks: 3 (limit: 503)
     Memory: 40.9M
        CPU: 1.093s
     CGroup: /system.slice/my-app.service
             └─309641 /home/YOUR_USER/.bun/bin/bun run /home/YOUR_USER/application/dist/index.js
```

Now you only started the app, but is not enough to automatically start the app on boot, you need to enable the service using this command:

```bash
sudo systemctl enable my-app
```

Once enabled, the app will start on boot, but if you want to change the contents of the service file, you need to run the following command after the edit in order to tell the system that the file changed:

```bash
sudo systemctl daemon-reload
```

And that is it!! Now you might want to know the following commands and recap the used ones:

```bash
sudo systemctl daemon-reload # Tells the systemd that some files got changed
sudo systemctl enable my-app # Enables the app to auto start
sudo systemctl disable my-app # Disable the app from auto starting
sudo systemctl start my-app # It starts the app if is stopped (This doesn't affect enable/disable)
sudo systemctl stop my-app # It stops the app (This doesn't affect enable/disable)
sudo systemctl restart my-app # It restarts the app
```

---

#### Now your application is now running as a daemon with systemd using Bun as the interpreter 🥳
