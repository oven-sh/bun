import os


def unzip_cmd():
    # Use 7-Zip if available (https://www.7-zip.org/)
    sevenzip = os.path.join(os.getenv('ProgramFiles', ''), '7-Zip', '7z.exe')
    if os.path.isfile(sevenzip):
        return [sevenzip, 'x']
    # Fall back to 'unzip' tool
    return ['unzip', '-q']


def zip_cmd():
    # Use 7-Zip if available (https://www.7-zip.org/)
    sevenzip = os.path.join(os.getenv('ProgramFiles', ''), '7-Zip', '7z.exe')
    if os.path.isfile(sevenzip):
        return [sevenzip, 'a', '-mx9']
    # Fall back to 'zip' tool
    return ['zip', '-rq']
