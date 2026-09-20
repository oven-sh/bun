# Windows Server can remove Defender altogether; it takes effect at the restart
# that ends the bake. Windows 11 cannot, and keeps it disabled.
Uninstall-WindowsFeature -Name Windows-Defender | Out-Null
