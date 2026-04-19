#!/usr/bin/env pwsh
<#
.SYNOPSIS
  Builds a Bun MSI installer from a signed bun.exe.

.DESCRIPTION
  Installs the WiX v5 dotnet tool if missing, renders the dialog/banner
  bitmaps from src/bun.ico (big centered logo on Bun-cream #fbf0df), then
  invokes `wix build` against packages/bun-msi/bun.wxs.

  Intended to be called from .buildkite/scripts/build-windows-msi.ps1 on a
  Windows x64 agent, once per target arch, with the already-signed bun.exe
  extracted from the corresponding bun-windows-<arch>.zip artifact.

.PARAMETER BunExe
  Path to the bun.exe to package. Will be copied verbatim into the MSI, so
  pass the *signed* one when building release artifacts.

.PARAMETER Arch
  Target architecture: x64 | arm64. The x64-baseline build also uses "x64"
  here — the MSI doesn't care about AVX2, only about ProgramFiles64Folder.

.PARAMETER Version
  Dotted version string for Package/@Version and ARP DisplayVersion, e.g.
  "1.3.12". Defaults to the contents of the repo's LATEST file.

.PARAMETER Output
  Path to write the resulting .msi. Defaults to
  ./bun-windows-<Arch>.msi next to this script.

.EXAMPLE
  ./build-msi.ps1 -BunExe ./bun.exe -Arch x64 -Version 1.3.12 -Output ./bun-windows-x64.msi
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$BunExe,

  [Parameter(Mandatory = $true)]
  [ValidateSet("x64", "arm64")]
  [string]$Arch,

  [string]$Version,

  [string]$Output
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Definition
$RepoRoot  = Resolve-Path (Join-Path $ScriptDir "..\..")

if (-not $Version) {
  $Version = (Get-Content (Join-Path $RepoRoot "LATEST") -Raw).Trim()
}
if ($Version -notmatch '^\d+\.\d+\.\d+$') {
  # MSI ProductVersion must be purely numeric major.minor.build; strip any
  # pre-release suffix (canary tags etc.) and fall back to 0.0.0 if nothing
  # usable remains so local/dev builds still produce a valid package.
  if ($Version -match '(\d+)\.(\d+)\.(\d+)') {
    $Version = "$($Matches[1]).$($Matches[2]).$($Matches[3])"
  } else {
    $Version = "0.0.0"
  }
}

if (-not $Output) {
  $Output = Join-Path $ScriptDir "bun-windows-$Arch.msi"
}

$BunExe = (Resolve-Path $BunExe).Path
if (-not (Test-Path $BunExe)) { throw "BunExe not found: $BunExe" }

$WorkDir = Join-Path $ScriptDir ".build-$Arch"
if (Test-Path $WorkDir) { Remove-Item $WorkDir -Recurse -Force }
New-Item -ItemType Directory -Path $WorkDir -Force | Out-Null

# ── WiX toolchain ───────────────────────────────────────────────────────────
# WiX v5 ships as a dotnet global tool. The Windows build image already has a
# .NET SDK via Visual Studio (see scripts/bootstrap.ps1), so `dotnet` is on
# PATH. Install to a local tool dir so we don't dirty the agent's global
# tool cache and so reruns are idempotent.
$WixVersion = "5.0.2"
$ToolDir    = Join-Path $ScriptDir ".wix"
$WixExe     = Join-Path $ToolDir "wix.exe"

if (-not (Test-Path $WixExe)) {
  Write-Host "-- Installing WiX $WixVersion dotnet tool -> $ToolDir"
  if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw "dotnet SDK not found on PATH; cannot install the WiX tool. " +
          "On CI this comes from scripts/bootstrap.ps1 via Visual Studio."
  }
  & dotnet tool install --tool-path $ToolDir --version $WixVersion wix | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "dotnet tool install wix failed ($LASTEXITCODE)" }
}
if (-not (Test-Path $WixExe)) { throw "wix.exe not found after install: $WixExe" }

# The UI dialog set (WixUI_InstallDir) lives in a separate extension package.
Write-Host "-- Ensuring WixToolset.UI.wixext is available"
& $WixExe extension add -g WixToolset.UI.wixext/$WixVersion 2>&1 | Out-Host

# ── bunx.exe ────────────────────────────────────────────────────────────────
# bunx dispatch is argv[0]-based (src/cli.zig), so bunx.exe is a literal copy
# of bun.exe. We copy instead of hardlink because Windows Installer tracks
# components by file identity and a hardlink would alias the KeyPaths.
$BunxExe = Join-Path $WorkDir "bunx.exe"
Copy-Item $BunExe $BunxExe -Force

# ── License RTF ─────────────────────────────────────────────────────────────
# WixUI requires RTF. Wrap the repo's LICENSE.md verbatim in a minimal RTF
# envelope so the text is accurate without maintaining a second copy.
$LicenseSrc = Join-Path $RepoRoot "LICENSE.md"
$LicenseRtf = Join-Path $WorkDir "license.rtf"
$licenseBody = (Get-Content $LicenseSrc -Raw) `
  -replace '\\', '\\\\' `
  -replace '{', '\{' `
  -replace '}', '\}' `
  -replace "`r`n", "`n"
$rtf = "{\rtf1\ansi\deff0{\fonttbl{\f0 Segoe UI;}}\fs18 " +
       ($licenseBody -replace "`n", '\par ') + "}"
Set-Content -Path $LicenseRtf -Value $rtf -Encoding ASCII -NoNewline

# ── Dialog / banner bitmaps ─────────────────────────────────────────────────
# Generated at build time from src/bun.ico so no binary BMPs live in git.
# The dialog bitmap is the full 493x312 welcome/exit canvas: cream Bun
# background (#fbf0df) with the logo rendered as large as fits while leaving
# room for the dialog's text column on the right. The banner is the 493x58
# strip along the top of interior pages with a small logo tucked into the
# right-hand corner where WixUI expects it.
Add-Type -AssemblyName System.Drawing

$IconPath = Join-Path $RepoRoot "src\bun.ico"
if (-not (Test-Path $IconPath)) { throw "Icon not found: $IconPath" }

function New-BunBitmap {
  param(
    [int]$Width,
    [int]$Height,
    [int]$LogoSize,
    [int]$LogoX,
    [int]$LogoY,
    [string]$OutPath
  )
  $bmp = New-Object System.Drawing.Bitmap $Width, $Height
  $g   = [System.Drawing.Graphics]::FromImage($bmp)
  try {
    $g.SmoothingMode      = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.InterpolationMode  = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.PixelOffsetMode    = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Bun brand gradient: cream #fbf0df -> blush #f6dece. These are the
    # exact stops from bun.com's hero; keeping them literal (not derived)
    # so a website palette tweak doesn't silently drift the installer.
    $top    = [System.Drawing.Color]::FromArgb(0xFB, 0xF0, 0xDF) # #fbf0df
    $bottom = [System.Drawing.Color]::FromArgb(0xF6, 0xDE, 0xCE) # #f6dece
    $rect   = New-Object System.Drawing.Rectangle 0, 0, $Width, $Height
    $brush  = New-Object System.Drawing.Drawing2D.LinearGradientBrush `
      $rect, $top, $bottom, [System.Drawing.Drawing2D.LinearGradientMode]::Vertical
    $g.FillRectangle($brush, $rect)
    $brush.Dispose()

    # Soft drop shadow under the logo so the face reads on the light
    # gradient without adding an outline to the icon itself.
    $shadow = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(40, 0, 0, 0))
    $g.FillEllipse($shadow, $LogoX + 3, $LogoY + ($LogoSize - [int]($LogoSize * 0.12)), $LogoSize - 6, [int]($LogoSize * 0.12))
    $shadow.Dispose()

    # Pull the largest frame out of the .ico (256x256) and draw it scaled.
    $icon = New-Object System.Drawing.Icon $IconPath, 256, 256
    $logo = $icon.ToBitmap()
    $g.DrawImage($logo, $LogoX, $LogoY, $LogoSize, $LogoSize)
    $logo.Dispose()
    $icon.Dispose()

    $bmp.Save($OutPath, [System.Drawing.Imaging.ImageFormat]::Bmp)
  } finally {
    $g.Dispose()
    $bmp.Dispose()
  }
}

$DialogBmp = Join-Path $WorkDir "dialog.bmp"
$BannerBmp = Join-Path $WorkDir "banner.bmp"

# Welcome/exit canvas: WixUI reserves roughly the right 330px for copy, so a
# ~200px logo hugging the left edge fills the visual column without clipping
# under localized strings. Vertical centering keeps the face centered on the
# "Welcome to the Bun Setup Wizard" headline.
New-BunBitmap -Width 493 -Height 312 -LogoSize 200 -LogoX 16 -LogoY 56 -OutPath $DialogBmp

# Interior banner: WixUI draws title text on the left ~400px, so the logo
# sits flush-right in the 58px strip with a small margin.
New-BunBitmap -Width 493 -Height 58  -LogoSize 48  -LogoX 440 -LogoY 5  -OutPath $BannerBmp

Write-Host "-- Rendered dialog/banner bitmaps"
Write-Host "   dialog: $((Get-Item $DialogBmp).Length) bytes"
Write-Host "   banner: $((Get-Item $BannerBmp).Length) bytes"

# ── Build ───────────────────────────────────────────────────────────────────
$Wxs = Join-Path $ScriptDir "bun.wxs"
Write-Host "-- wix build ($Arch, v$Version) -> $Output"

# -sw1076: AllowSameVersionUpgrades intentionally set; WiX warns that same
#          version upgrades are detected as major upgrades. That's the point.
& $WixExe build `
  -arch $Arch `
  -ext WixToolset.UI.wixext `
  -d "BunVersion=$Version" `
  -d "BunArch=$Arch" `
  -d "BunExe=$BunExe" `
  -d "BunxExe=$BunxExe" `
  -d "BunIcon=$IconPath" `
  -d "BunBannerBmp=$BannerBmp" `
  -d "BunDialogBmp=$DialogBmp" `
  -d "BunLicense=$LicenseRtf" `
  -sw1076 `
  -o $Output `
  $Wxs | Out-Host

if ($LASTEXITCODE -ne 0) { throw "wix build failed ($LASTEXITCODE)" }
if (-not (Test-Path $Output)) { throw "wix build reported success but $Output is missing" }

Write-Host "-- Built $Output ($('{0:N1}' -f ((Get-Item $Output).Length / 1MB)) MB)"

Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
