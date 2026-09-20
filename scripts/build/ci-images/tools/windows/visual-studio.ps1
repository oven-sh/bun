# The "Desktop development with C++" workload: MSVC, the Windows SDK and their
# build tools, at whatever versions this release channel serves today.
$installer = "$env:TEMP\vs_community.exe"
Download $VISUAL_STUDIO_URL $installer
$arguments = "--passive --norestart --wait --force --locale en-US --add Microsoft.VisualStudio.Workload.NativeDesktop --includeRecommended"
$process = Start-Process $installer -ArgumentList $arguments -Wait -PassThru -NoNewWindow
# 3010: installed, and a restart is needed. The bake restarts before it ends.
if ($process.ExitCode -ne 0 -and $process.ExitCode -ne 3010) { Fail "the Visual Studio installer exited with code $($process.ExitCode)" }
Remove-Item $installer
