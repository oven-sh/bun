# To convert to a AWS user data script, use the following format:
# <powershell>
#  ...
# </powershell>
# <powershellArguments>-ExecutionPolicy Unrestricted -NoProfile -NonInteractive</powershellArguments>

# Set the execution policy to unrestricted
Set-ExecutionPolicy Unrestricted -Force -NoProfile -NonInteractive

# Setup SSH server to receive incoming SSH connections
New-Item -Path "C:\ProgramData\ssh" -ItemType Directory -Force
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultShell -Value "C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe" -PropertyType String -Force
New-ItemProperty -Path "HKLM:\SOFTWARE\OpenSSH" -Name DefaultUser -Value "Administrator" -PropertyType String -Force

# Install Chocolatey
Set-ExecutionPolicy Bypass -Scope Process -Force; [System.Net.ServicePointManager]::SecurityProtocol = [System.Net.ServicePointManager]::SecurityProtocol -bor 3072; iex ((New-Object System.Net.WebClient).DownloadString('https://chocolatey.org/install.ps1'))

# Install Git
choco install git -y
